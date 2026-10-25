"""Supplement existing sources with public Santa Catarina sale listings.

Only follows public listing links, respects each host's robots policy and keeps
the original source snapshot when a request fails. No contact data is inferred.
"""
from __future__ import annotations

import argparse
import html
import json
import re
from urllib.parse import urlparse

from public_property_discovery import decode, fetch, parse_listing, parse_robots, robots_allowed, safe_url, same_domain, utc_now
from sanitize_public_properties import is_real_estate

ROGGA_LISTINGS = (
    "https://imoveis.rogga.com.br/torres-do-gloria-urbanclub",
    "https://imoveis.rogga.com.br/urban-baviera",
    "https://imoveis.rogga.com.br/urban-azaleia",
    "https://imoveis.rogga.com.br/evolution-urban-club",
)


def sale_listing(url: str) -> bool:
    path = urlparse(url).path.lower()
    return path.startswith("/imovel/") and "-a-venda-" in path and "-sc-" in path and "/id-" in path


def page_links(url: str, domain: str, rules: list[str]) -> list[str]:
    if not robots_allowed(url, rules):
        return []
    status, final, data, kind = fetch(url)
    if status != 200 or not same_domain(final, domain):
        return []
    text = decode(data, kind, final)
    links = [safe_url(html.unescape(value), final) for value in re.findall(r'href=["\']([^"\']+)', text, re.I)]
    return list(dict.fromkeys(link for link in links if link and same_domain(link, domain) and robots_allowed(link, rules)))


def rotating(values: list[str], cursor: int, limit: int) -> tuple[list[str], int]:
    if not values:
        return [], 0
    cursor %= len(values)
    selected = [values[(cursor + offset) % len(values)] for offset in range(min(limit, len(values)))]
    return selected, (cursor + len(selected)) % len(values)


def supplement(payload: dict, code: str, name: str, domain: str, limit: int) -> dict:
    if code not in {"chavesnamao", "rogga"}:
        return payload
    source = payload.setdefault("source", {})
    items = {item["source_url"]: item for item in payload.get("items", []) if item.get("source_url")}
    removed = set(payload.get("removed_urls") or [])
    candidates = []
    policies = {}
    if code == "chavesnamao":
        _, rules, allowed = parse_robots(domain)
        if not allowed:
            return payload
        policies[domain] = (rules, allowed)
        state_url = "https://www.chavesnamao.com.br/imoveis-a-venda/sc/"
        links = page_links(state_url, domain, rules)
        city_links = [link for link in links if re.fullmatch(r"/imoveis-a-venda/sc-[a-z-]+/", urlparse(link).path)]
        cities, source["sc_city_cursor"] = rotating(city_links, int(source.get("sc_city_cursor", 0)), 2)
        pages = [links, page_links("https://www.chavesnamao.com.br/imoveis-a-venda/sc-joinville/", domain, rules)]
        pages.extend(page_links(city, domain, rules) for city in cities)
        pages = [[link for link in page if sale_listing(link)] for page in pages]
        # Interleave cities so the state page cannot consume the entire batch.
        candidates = list(dict.fromkeys(page[index] for index in range(max((len(page) for page in pages), default=0)) for page in pages if index < len(page)))
    else:
        candidates = list(ROGGA_LISTINGS)
    selected, source["sc_listing_cursor"] = rotating(candidates, int(source.get("sc_listing_cursor", 0)), limit)
    checked = accepted = 0
    for url in selected:
        host = urlparse(url).hostname or domain
        if host not in policies:
            _, rules, allowed = parse_robots(host)
            policies[host] = (rules, allowed)
        rules, allowed = policies[host]
        if not allowed or not robots_allowed(url, rules):
            continue
        listing, gone = parse_listing(url, domain, code, name, rules)
        checked += 1
        if gone:
            removed.add(url)
            items.pop(url, None)
            continue
        if not listing:
            continue
        if code == "rogga" and not listing.get("location_city"):
            # These official project pages explicitly name Joinville in their headline.
            evidence = f"{listing.get('title', '')} {listing.get('description') or ''}"
            if re.search(r"\bJoinville\b", evidence, re.I):
                listing["location_city"], listing["location_state"] = "Joinville", "SC"
        if listing.get("location_state") != "SC" or not is_real_estate(listing):
            continue
        listing["metadata"]["regional_discovery"] = "SC"
        items[listing["source_url"]] = listing
        accepted += 1
    source.update(sc_checked_at=utc_now(), sc_checked_count=checked, sc_accepted_count=accepted,
                  sc_found_count=sum(item.get("location_state") == "SC" for item in items.values()), found_count=len(items))
    if items:
        source["status"] = "active"
    payload.update(items=list(items.values()), removed_urls=sorted(removed))
    return payload


def main():
    parser = argparse.ArgumentParser()
    for key in ("code", "name", "domain", "input"):
        parser.add_argument("--" + key, required=True)
    parser.add_argument("--limit", type=int, default=32)
    args = parser.parse_args()
    if args.code not in {"chavesnamao", "rogga"}:
        return
    with open(args.input, encoding="utf-8") as handle:
        payload = json.load(handle)
    payload = supplement(payload, args.code, args.name, args.domain, max(1, min(args.limit, 40)))
    with open(args.input, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps({key: value for key, value in payload["source"].items() if key.startswith("sc_")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
