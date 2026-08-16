#!/usr/bin/env python3
"""MercadoImobi public property discovery.

Discovers only publicly accessible property pages. It respects robots.txt,
does not authenticate, does not bypass CAPTCHA/paywalls, and only extracts
information already present in public HTML/JSON-LD metadata.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import html as html_lib
import ipaddress
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

USER_AGENT = "MercadoImobi-PublicDiscovery/1.0 (+https://mercadoimobi.rdmconsultoriaimobiliaria.com.br)"
MAX_RESPONSE_BYTES = 3_000_000
PREVIOUS_SNAPSHOT = (
    "https://raw.githubusercontent.com/RuanMarcos38/mercado-imobiliario/"
    "public-data-cache/public-properties.json"
)
PROPERTY_KEYWORDS = (
    "imovel",
    "imoveis",
    "imóvel",
    "imóveis",
    "apartamento",
    "apartamentos",
    "casa",
    "casas",
    "sobrado",
    "terreno",
    "cobertura",
    "studio",
    "loft",
    "empreendimento",
    "empreendimentos",
    "lancamento",
    "lançamento",
    "venda",
    "aluguel",
    "locacao",
    "locação",
    "property",
    "properties",
    "listing",
    "anuncio",
    "anúncio",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def clean_text(value: str | None) -> str | None:
    if not value:
        return None
    value = re.sub(r"<[^>]+>", " ", value)
    value = html_lib.unescape(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = re.sub(r"[^0-9,.-]", "", str(value))
    if not text:
        return None
    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def currency_number(value: Any) -> float | None:
    """Parse property prices without truncating Brazilian thousands separators."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    text = re.sub(r"[^0-9,.-]", "", str(value))
    if not text:
        return None

    if "," in text and "." in text:
        if text.rfind(",") > text.rfind("."):
            text = text.replace(".", "").replace(",", ".")
        else:
            text = text.replace(",", "")
    elif "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif "." in text:
        parts = text.split(".")
        if len(parts) > 1 and all(part.isdigit() for part in parts) and all(len(part) == 3 for part in parts[1:]):
            text = "".join(parts)

    try:
        return float(text)
    except ValueError:
        return None


def safe_url(value: str, base: str | None = None) -> str | None:
    try:
        url = urllib.parse.urljoin(base or "", value.strip())
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return None
        host = parsed.hostname.lower().rstrip(".")
        if host in {"localhost", "localhost.localdomain"} or host.endswith(".local"):
            return None
        try:
            address = ipaddress.ip_address(host)
            if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
                return None
        except ValueError:
            pass
        return urllib.parse.urlunparse(parsed._replace(fragment=""))
    except Exception:
        return None


def same_domain(url: str, domain: str) -> bool:
    try:
        host = (urllib.parse.urlparse(url).hostname or "").lower().removeprefix("www.")
        root = domain.lower().removeprefix("www.")
        return host == root or host.endswith("." + root)
    except Exception:
        return False


def fetch(url: str, *, timeout: int = 18, range_only: bool = False) -> tuple[int, str, bytes, str]:
    target = safe_url(url)
    if not target:
        return 0, url, b"", ""
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
    }
    if range_only:
        headers["Range"] = "bytes=0-65535"
    request = urllib.request.Request(target, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read(MAX_RESPONSE_BYTES + 1)[:MAX_RESPONSE_BYTES]
            return (
                int(response.status or 200),
                response.geturl(),
                data,
                response.headers.get("Content-Type", ""),
            )
    except urllib.error.HTTPError as exc:
        body = b""
        try:
            body = exc.read(min(MAX_RESPONSE_BYTES, 65536))
        except Exception:
            pass
        return exc.code, exc.geturl() or target, body, exc.headers.get("Content-Type", "") if exc.headers else ""
    except Exception:
        return 0, target, b"", ""


def decode(data: bytes, content_type: str, url: str) -> str:
    if not data:
        return ""
    if url.endswith(".gz") or "gzip" in content_type.lower() or data[:2] == b"\x1f\x8b":
        try:
            data = gzip.decompress(data)
        except Exception:
            pass
    charset_match = re.search(r"charset=([\w-]+)", content_type, re.I)
    charsets = [charset_match.group(1)] if charset_match else []
    charsets += ["utf-8", "latin-1"]
    for charset in charsets:
        try:
            return data.decode(charset)
        except Exception:
            continue
    return data.decode("utf-8", errors="replace")


def load_previous() -> dict[str, Any]:
    status, final_url, data, content_type = fetch(PREVIOUS_SNAPSHOT, timeout=12)
    if status != 200:
        return {"items": [], "sources": {}}
    try:
        return json.loads(decode(data, content_type, final_url))
    except Exception:
        return {"items": [], "sources": {}}


def parse_robots(domain: str) -> tuple[list[str], list[str], bool]:
    status, final_url, data, content_type = fetch(f"https://{domain}/robots.txt", timeout=10)
    if status in {401, 403}:
        return [], [], False
    if status not in {200, 404, 0}:
        return [], [], True
    text = decode(data, content_type, final_url) if status == 200 else ""
    sitemaps: list[str] = []
    rules: list[str] = []
    active = False
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or ":" not in line:
            continue
        key, value = [part.strip() for part in line.split(":", 1)]
        lower = key.lower()
        if lower == "sitemap":
            candidate = safe_url(value, f"https://{domain}/")
            if candidate and same_domain(candidate, domain):
                sitemaps.append(candidate)
        elif lower == "user-agent":
            active = value == "*"
        elif active and lower in {"disallow", "allow"}:
            rules.append(f"{lower}:{value}")
    return list(dict.fromkeys(sitemaps)), rules, True


def robot_pattern_match(path: str, rule: str) -> bool:
    if not rule:
        return False
    escaped = re.escape(rule).replace(r"\*", ".*")
    if escaped.endswith(r"\$"):
        escaped = escaped[:-2] + "$"
    else:
        escaped = escaped + ".*"
    try:
        return bool(re.match("^" + escaped, path))
    except re.error:
        return path.startswith(rule.replace("*", ""))


def robots_allowed(url: str, rules: list[str]) -> bool:
    path = urllib.parse.urlparse(url).path or "/"
    matches: list[tuple[int, bool]] = []
    for rule in rules:
        kind, value = rule.split(":", 1)
        if not value:
            continue
        if robot_pattern_match(path, value):
            matches.append((len(value), kind == "allow"))
    if not matches:
        return True
    matches.sort(key=lambda item: item[0], reverse=True)
    return matches[0][1]


def extract_locs(xml_text: str) -> list[str]:
    return [html_lib.unescape(match).strip() for match in re.findall(r"<loc[^>]*>([\s\S]*?)</loc>", xml_text, re.I) if match.strip()]


def likely_property_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    text = urllib.parse.unquote((parsed.path + " " + parsed.query).lower())
    if any(word in text for word in PROPERTY_KEYWORDS):
        return True
    segments = [segment for segment in parsed.path.split("/") if segment]
    return len(segments) >= 3 and any(char.isdigit() for char in parsed.path)


def discover_urls(domain: str, sitemap_seeds: list[str], rules: list[str]) -> list[str]:
    seeds = list(sitemap_seeds)
    for suffix in ("/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"):
        candidate = f"https://{domain}{suffix}"
        if candidate not in seeds:
            seeds.append(candidate)

    queue = seeds[:]
    visited: set[str] = set()
    page_urls: list[str] = []
    while queue and len(visited) < 25 and len(page_urls) < 12000:
        sitemap = queue.pop(0)
        if sitemap in visited or not same_domain(sitemap, domain) or not robots_allowed(sitemap, rules):
            continue
        visited.add(sitemap)
        status, final_url, data, content_type = fetch(sitemap, timeout=16)
        if status != 200:
            continue
        text = decode(data, content_type, final_url)
        locs = extract_locs(text)
        for loc in locs:
            candidate = safe_url(loc, final_url)
            if not candidate or not same_domain(candidate, domain):
                continue
            path = urllib.parse.urlparse(candidate).path.lower()
            if path.endswith((".xml", ".xml.gz")) or "sitemap" in path:
                if len(visited) + len(queue) < 25:
                    queue.append(candidate)
            elif robots_allowed(candidate, rules) and likely_property_url(candidate):
                page_urls.append(candidate)
                if len(page_urls) >= 12000:
                    break

    if page_urls:
        return list(dict.fromkeys(page_urls))

    # Public-homepage fallback when a site does not publish a sitemap.
    status, final_url, data, content_type = fetch(f"https://{domain}/", timeout=14)
    if status == 200:
        text = decode(data, content_type, final_url)
        for href in re.findall(r"href=[\"']([^\"']+)[\"']", text, re.I):
            candidate = safe_url(html_lib.unescape(href), final_url)
            if candidate and same_domain(candidate, domain) and robots_allowed(candidate, rules) and likely_property_url(candidate):
                page_urls.append(candidate)
    return list(dict.fromkeys(page_urls))


def meta_value(text: str, names: list[str]) -> str | None:
    for name in names:
        escaped = re.escape(name)
        patterns = [
            rf"<meta[^>]+(?:property|name)=[\"']{escaped}[\"'][^>]+content=[\"']([^\"']+)[\"'][^>]*>",
            rf"<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+(?:property|name)=[\"']{escaped}[\"'][^>]*>",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.I)
            if match:
                return clean_text(match.group(1))
    return None


def json_ld_objects(text: str) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    for raw in re.findall(r"<script[^>]+type=[\"']application/ld\+json[\"'][^>]*>([\s\S]*?)</script>", text, re.I):
        candidate = html_lib.unescape(raw).strip().strip("\ufeff")
        try:
            parsed = json.loads(candidate)
        except Exception:
            continue
        stack = parsed if isinstance(parsed, list) else [parsed]
        while stack:
            value = stack.pop()
            if isinstance(value, dict):
                objects.append(value)
                graph = value.get("@graph")
                if isinstance(graph, list):
                    stack.extend(graph)
            elif isinstance(value, list):
                stack.extend(value)
    return objects


def first_dict_value(objects: list[dict[str, Any]], key: str) -> Any:
    for obj in objects:
        value = obj.get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def collect_images(objects: list[dict[str, Any]], page_text: str, page_url: str) -> list[str]:
    values: list[str] = []
    og = meta_value(page_text, ["og:image", "twitter:image"])
    if og:
        values.append(og)
    for obj in objects:
        image = obj.get("image")
        if isinstance(image, str):
            values.append(image)
        elif isinstance(image, list):
            values.extend(str(item) for item in image if isinstance(item, str))
        elif isinstance(image, dict) and isinstance(image.get("url"), str):
            values.append(image["url"])
    result: list[str] = []
    for value in values:
        candidate = safe_url(value, page_url)
        if candidate and candidate not in result:
            result.append(candidate)
        if len(result) >= 12:
            break
    return result


def extract_contact(text: str) -> tuple[str | None, str | None, str | None]:
    whatsapp = None
    for match in re.findall(r"(?:https?://)?(?:wa\.me/|api\.whatsapp\.com/send\?phone=)(\+?\d{8,15})", text, re.I):
        digits = re.sub(r"\D", "", match)
        if digits:
            whatsapp = digits
            break
    phone = None
    tel = re.search(r"href=[\"']tel:([^\"']+)[\"']", text, re.I)
    if tel:
        digits = re.sub(r"\D", "", tel.group(1))
        if len(digits) >= 8:
            phone = digits
    if not phone:
        visible = re.search(r"(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9\s*)?\d{4}[-.\s]?\d{4}", clean_text(text) or "")
        if visible:
            digits = re.sub(r"\D", "", visible.group(0))
            if len(digits) >= 8:
                phone = digits
    email = None
    mail = re.search(r"href=[\"']mailto:([^?\"']+)", text, re.I)
    if mail:
        email = mail.group(1).strip().lower()
    return phone, whatsapp, email


def schema_address(objects: list[dict[str, Any]]) -> tuple[str | None, str | None, str | None]:
    for obj in objects:
        address = obj.get("address")
        if not isinstance(address, dict):
            continue
        street = clean_text(str(address.get("streetAddress") or ""))
        neighborhood = clean_text(str(address.get("addressLocality") or ""))
        region = clean_text(str(address.get("addressRegion") or ""))
        parts = [street]
        address_text = ", ".join(part for part in parts if part) or None
        return address_text, neighborhood, region[:2].upper() if region else None
    return None, None, None


def infer_property_type(text: str, schema_types: list[str]) -> str | None:
    haystack = " ".join(schema_types + [text]).lower()
    mapping = [
        ("apart", "Apartamento"),
        ("house", "Casa"),
        ("casa", "Casa"),
        ("sobrado", "Sobrado"),
        ("terreno", "Terreno"),
        ("land", "Terreno"),
        ("cobertura", "Cobertura"),
        ("studio", "Studio"),
        ("loft", "Loft"),
        ("commercial", "Comercial"),
        ("comercial", "Comercial"),
    ]
    for needle, label in mapping:
        if needle in haystack:
            return label
    return None


def extract_price(objects: list[dict[str, Any]], text: str) -> float | None:
    plain = clean_text(text) or ""

    # Prefer the purchase/sale amount on pages that expose rent and purchase together.
    # This keeps cards from showing a rental price as the property's purchase price.
    purchase_patterns = [
        r"(?:Valores a partir de|Média das últimas negociações).{0,320}?\bCompra\b\s*R\$\s*([0-9][0-9.\s]*(?:,[0-9]{2})?)",
        r"\bValor do imóvel\b.{0,120}?R\$\s*([0-9][0-9.\s]*(?:,[0-9]{2})?)",
        r"\b(?:Preço|Valor)\s+(?:de\s+)?(?:venda|compra)\b.{0,120}?R\$\s*([0-9][0-9.\s]*(?:,[0-9]{2})?)",
        r"\b(?:Compra|Comprar)\b.{0,120}?R\$\s*([0-9][0-9.\s]*(?:,[0-9]{2})?)",
    ]
    for pattern in purchase_patterns:
        match = re.search(pattern, plain, re.I)
        if match:
            value = currency_number(match.group(1))
            if value and value > 0:
                return value

    # If a combined rent/purchase page explicitly has no purchase amount, do not
    # fall back to the rental amount and mislabel it as a sale price.
    purchase_unavailable = re.search(
        r"(?:Valores a partir de|Média das últimas negociações).{0,320}?\bCompra\b\s*(?:-|–|—|indispon[ií]vel|não disponível)",
        plain,
        re.I,
    )
    if purchase_unavailable:
        return None

    for obj in objects:
        offers = obj.get("offers")
        offer_list = offers if isinstance(offers, list) else [offers]
        for offer in offer_list:
            if isinstance(offer, dict):
                value = currency_number(offer.get("price") or offer.get("lowPrice"))
                if value and value > 0:
                    return value
        value = currency_number(obj.get("price"))
        if value and value > 0:
            return value
    meta_price = meta_value(text, ["product:price:amount", "og:price:amount"])
    value = currency_number(meta_price)
    if value and value > 0:
        return value
    match = re.search(r"R\$\s*([0-9][0-9.\s]*(?:,[0-9]{2})?)", plain, re.I)
    return currency_number(match.group(1)) if match else None


def extract_int(patterns: list[str], text: str) -> int | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            try:
                return int(match.group(1))
            except ValueError:
                continue
    return None


def parse_listing(url: str, domain: str, code: str, name: str, rules: list[str]) -> tuple[dict[str, Any] | None, bool]:
    if not robots_allowed(url, rules):
        return None, False
    status, final_url, data, content_type = fetch(url, timeout=18)
    if status in {404, 410}:
        return None, True
    if status < 200 or status >= 400 or not same_domain(final_url, domain):
        return None, False
    text = decode(data, content_type, final_url)
    if not text:
        return None, False
    robots_meta = meta_value(text, ["robots", "googlebot"])
    if robots_meta and "noindex" in robots_meta.lower():
        return None, False

    objects = json_ld_objects(text)
    schema_types: list[str] = []
    for obj in objects:
        value = obj.get("@type")
        if isinstance(value, str):
            schema_types.append(value)
        elif isinstance(value, list):
            schema_types.extend(str(item) for item in value)

    title = meta_value(text, ["og:title", "twitter:title"])
    if not title:
        title_tag = re.search(r"<title[^>]*>([\s\S]*?)</title>", text, re.I)
        title = clean_text(title_tag.group(1)) if title_tag else None
    title = title or clean_text(str(first_dict_value(objects, "name") or ""))
    if not title:
        return None, False

    description = meta_value(text, ["description", "og:description"])
    description = description or clean_text(str(first_dict_value(objects, "description") or ""))
    property_type = infer_property_type(f"{title} {description or ''} {final_url}", schema_types)
    price = extract_price(objects, text)
    address, city, state = schema_address(objects)
    plain = clean_text(text) or ""

    bedrooms = extract_int([r"(\d+)\s*(?:quartos?|dormit[oó]rios?|dorms?)"], plain)
    bathrooms = extract_int([r"(\d+)\s*(?:banheiros?|banh\.?|wcs?)"], plain)
    area_match = re.search(r"([0-9]+(?:[.,][0-9]+)?)\s*m(?:²|2)\b", plain, re.I)
    area = number(area_match.group(1)) if area_match else None
    phone, whatsapp, email = extract_contact(text)
    images = collect_images(objects, text, final_url)

    canonical_match = re.search(r"<link[^>]+rel=[\"']canonical[\"'][^>]+href=[\"']([^\"']+)[\"']", text, re.I)
    source_url = safe_url(canonical_match.group(1), final_url) if canonical_match else final_url
    if not source_url or not same_domain(source_url, domain):
        source_url = final_url

    # Avoid generic home/category pages masquerading as listings.
    evidence = sum(
        [
            1 if property_type else 0,
            1 if price else 0,
            1 if address or city else 0,
            1 if bedrooms is not None or area is not None else 0,
            1 if images else 0,
            1 if any("realestate" in value.lower() or "apartment" in value.lower() or "house" in value.lower() for value in schema_types) else 0,
        ]
    )
    if evidence < 2:
        return None, False

    property_id = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:32]
    return (
        {
            "title": title[:300],
            "description": description[:4000] if description else None,
            "price": price,
            "location_city": city,
            "location_state": state,
            "location_address": address,
            "property_type": property_type,
            "bedrooms": bedrooms,
            "bathrooms": bathrooms,
            "area_sqm": area,
            "images": images,
            "source_url": source_url,
            "source_portal": name,
            "contact_name": name,
            "contact_phone": phone,
            "contact_whatsapp": whatsapp,
            "contact_email": email,
            "source_property_id": property_id,
            "source_code": code,
            "metadata": {
                "public_discovery": True,
                "source_code": code,
                "discovery_method": "public_sitemap_or_page",
                "robots_respected": True,
                "checked_at": utc_now(),
            },
        },
        False,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--batch-size", type=int, default=24)
    args = parser.parse_args()

    code = args.code.strip()
    name = args.name.strip()
    domain = args.domain.strip().lower().removeprefix("https://").removeprefix("http://").strip("/")
    batch_size = max(5, min(args.batch_size, 40))
    checked_at = utc_now()
    previous = load_previous()
    previous_items = {
        item.get("source_url"): item
        for item in previous.get("items", [])
        if item.get("source_code") == code and item.get("source_url")
    }
    previous_source = previous.get("sources", {}).get(code, {}) if isinstance(previous.get("sources"), dict) else {}

    sitemap_seeds, rules, robots_ok = parse_robots(domain)
    if not robots_ok:
        result = {
            "source": {
                "code": code,
                "name": name,
                "domain": domain,
                "status": "blocked",
                "cursor": int(previous_source.get("cursor", 0) or 0),
                "candidate_count": 0,
                "checked_count": 0,
                "found_count": len(previous_items),
                "checked_at": checked_at,
                "robots_respected": True,
            },
            "items": list(previous_items.values()),
            "removed_urls": [],
        }
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(result, handle, ensure_ascii=False)
        return 0

    candidates = discover_urls(domain, sitemap_seeds, rules)
    cursor = int(previous_source.get("cursor", 0) or 0)
    selected: list[str] = []
    if candidates:
        cursor %= len(candidates)
        for offset in range(min(batch_size, len(candidates))):
            selected.append(candidates[(cursor + offset) % len(candidates)])
        next_cursor = (cursor + len(selected)) % len(candidates)
    else:
        next_cursor = 0

    items = dict(previous_items)
    removed_urls: set[str] = set()
    checked = 0
    discovered_now = 0
    for url in selected:
        listing, removed = parse_listing(url, domain, code, name, rules)
        checked += 1
        if removed:
            removed_urls.add(url)
            items.pop(url, None)
        elif listing:
            items[listing["source_url"]] = listing
            discovered_now += 1
        time.sleep(0.15)

    # Recheck a rotating sample of previously known pages. Only 404/410 removes a listing.
    previous_urls = [url for url in previous_items if url not in selected]
    sample_start = cursor % max(1, len(previous_urls)) if previous_urls else 0
    for offset in range(min(8, len(previous_urls))):
        url = previous_urls[(sample_start + offset) % len(previous_urls)]
        if not robots_allowed(url, rules):
            continue
        status, _, _, _ = fetch(url, timeout=12, range_only=True)
        if status in {404, 410}:
            removed_urls.add(url)
            items.pop(url, None)
        time.sleep(0.1)

    status = "active" if items else ("limited" if candidates else "limited")
    result = {
        "source": {
            "code": code,
            "name": name,
            "domain": domain,
            "status": status,
            "cursor": next_cursor,
            "candidate_count": len(candidates),
            "checked_count": checked,
            "discovered_now": discovered_now,
            "found_count": len(items),
            "checked_at": checked_at,
            "robots_respected": True,
        },
        "items": list(items.values()),
        "removed_urls": sorted(removed_urls),
    }
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(result["source"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
