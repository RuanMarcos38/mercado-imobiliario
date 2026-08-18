#!/usr/bin/env python3
"""Supplement public property discovery from official listing entrypoints.

This helper only follows public same-domain links, reuses the main crawler's
robots.txt checks and parser, and never authenticates or bypasses access controls.
It exists for builders whose XML sitemaps do not expose their active inventory.
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import urllib.parse
from typing import Any

from public_property_discovery import (
    decode,
    fetch,
    parse_listing,
    parse_robots,
    robots_allowed,
    safe_url,
    same_domain,
)

ENTRYPOINTS: dict[str, list[str]] = {
    "curyconstrutora.com.br": ["/imoveis/"],
    "direcional.com.br": ["/", "/empreendimentos/"],
    "inicioempreendimentos.com.br": ["/"],
    "mouradubeux.com.br": [
        "/alagoas/nossos-imoveis",
        "/bahia/nossos-imoveis",
        "/ceara/nossos-imoveis",
        "/paraiba/nossos-imoveis",
        "/pernambuco/nossos-imoveis",
        "/rio-grande-do-norte/nossos-imoveis",
        "/sergipe/nossos-imoveis",
    ],
    "rottasconstrutora.com.br": ["/rottas/imoveis-a-venda/"],
    "tenda.com.br": ["/", "/loja-virtual"],
    "orulo.com.br": ["/"],
    "imovelweb.com.br": ["/"],
    "rivaincorporadora.com.br": ["/imoveis/"],
}

EXCLUDED_PATH_PARTS = (
    "/blog/",
    "/noticia",
    "/imprensa/",
    "/institucional/",
    "/quem-somos",
    "/contato",
    "/carreiras",
    "/trabalhe-conosco",
    "/politica",
    "/privacidade",
    "/termos",
    "/faq",
    "/fornecedor",
    "/cliente",
)


def normalized_domain(value: str) -> str:
    return value.lower().removeprefix("https://").removeprefix("http://").strip("/")


def source_link_is_candidate(url: str, domain: str) -> bool:
    path = urllib.parse.unquote(urllib.parse.urlparse(url).path).lower()
    if not path or path == "/" or any(part in path for part in EXCLUDED_PATH_PARTS):
        return False

    if domain == "curyconstrutora.com.br":
        return bool(re.search(r"/imovel/[^/]+/?$", path))
    if domain == "direcional.com.br":
        return "/empreendimentos/" in path or "/portifolio/" in path
    if domain == "mouradubeux.com.br":
        return "/nossos-imoveis" not in path and len([part for part in path.split("/") if part]) >= 2
    if domain == "rottasconstrutora.com.br":
        return path.startswith("/rottas/") and any(token in path for token in ("/meo/", "/prime/", "/porto", "/vega", "/empreendimento"))
    if domain == "orulo.com.br":
        return bool(re.match(r"^/(?:a|s)/[^/]+/\d+/?$", path))
    if domain == "imovelweb.com.br":
        return "/propriedades/" in path or "/imoveis/" in path
    if domain == "rivaincorporadora.com.br":
        return "/empreendimentos/" in path
    if domain == "tenda.com.br":
        return path.startswith("/loja-virtual/") and path.count("/") >= 2
    if domain == "inicioempreendimentos.com.br":
        # Project pages use short slugs. The shared listing parser and sanitizer
        # are the final boundary, so generic pages are still rejected later.
        return len([part for part in path.split("/") if part]) <= 2
    return False


def links_from_page(url: str, domain: str, rules: list[str]) -> list[str]:
    if not robots_allowed(url, rules):
        return []
    status, final_url, data, content_type = fetch(url, timeout=18)
    if status < 200 or status >= 400 or not same_domain(final_url, domain):
        return []
    text = decode(data, content_type, final_url)
    links: list[str] = []
    for href in re.findall(r"href=[\"']([^\"']+)[\"']", text, re.I):
        candidate = safe_url(html_lib.unescape(href), final_url)
        if not candidate or not same_domain(candidate, domain) or not robots_allowed(candidate, rules):
            continue
        if source_link_is_candidate(candidate, domain):
            links.append(candidate)
    return list(dict.fromkeys(links))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--domain", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--limit", type=int, default=40)
    args = parser.parse_args()

    domain = normalized_domain(args.domain)
    entrypoints = ENTRYPOINTS.get(domain, [])
    if not entrypoints:
        return 0

    with open(args.input, encoding="utf-8") as handle:
        payload: dict[str, Any] = json.load(handle)

    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    items = {
        item.get("source_url"): item
        for item in payload.get("items", [])
        if isinstance(item, dict) and item.get("source_url")
    }
    removed = set(payload.get("removed_urls") or [])

    _, rules, robots_ok = parse_robots(domain)
    if not robots_ok:
        return 0

    candidates: list[str] = []
    for path in entrypoints:
        entry = safe_url(path, f"https://{domain}/")
        if entry:
            candidates.extend(links_from_page(entry, domain, rules))

    candidates = [url for url in dict.fromkeys(candidates) if url not in items]
    checked = 0
    discovered = 0
    for url in candidates[: max(1, min(args.limit, 80))]:
        listing, was_removed = parse_listing(url, domain, args.code, args.name, rules)
        checked += 1
        if was_removed:
            removed.add(url)
            items.pop(url, None)
        elif listing:
            items[listing["source_url"]] = listing
            discovered += 1

    source["entrypoint_candidate_count"] = len(candidates)
    source["entrypoint_checked_count"] = checked
    source["entrypoint_discovered_now"] = discovered
    source["found_count"] = len(items)
    if items:
        source["status"] = "active"

    payload["source"] = source
    payload["items"] = list(items.values())
    payload["removed_urls"] = sorted(removed)
    with open(args.input, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))

    print(json.dumps({
        "code": args.code,
        "entrypoint_candidates": len(candidates),
        "checked": checked,
        "discovered": discovered,
        "total": len(items),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
