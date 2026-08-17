#!/usr/bin/env python3
"""Repair stale/truncated QuintoAndar purchase prices in a discovery snapshot.

The normal discovery job is intentionally incremental. This repair pass revisits every
cached QuintoAndar card that advertises purchase availability but still has a missing
or implausibly low purchase price, so old values such as R$ 103, R$ 3 or R$ 550 do not
remain in the public cache for many hourly cycles.

Only public pages allowed by robots.txt are read. No authentication, CAPTCHA bypass or
private endpoint is used.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

import public_property_discovery as discovery

DOMAIN = "quintoandar.com.br"
CODE = "quintoandar"
NAME = "QuintoAndar"
MIN_PLAUSIBLE_PURCHASE_PRICE = 20_000.0
PURCHASE_TITLE_TERMS = (
    "alugue ou compre",
    "alugar ou comprar",
    "compre",
    "comprar",
    "compra",
    "venda",
    "à venda",
    "a venda",
)


def as_price(value: Any) -> float | None:
    parsed = discovery.currency_number(value)
    if parsed is None:
        return None
    return float(parsed)


def is_purchase_card(item: dict[str, Any]) -> bool:
    title = str(item.get("title") or "").lower()
    url = str(item.get("source_url") or "").lower()
    return any(term in title for term in PURCHASE_TITLE_TERMS) or "/comprar/" in url


def is_collection_page(url: str) -> bool:
    """QuintoAndar /condominios/... pages are neighborhood collections, not a property."""
    normalized = url.lower().split("?", 1)[0].rstrip("/")
    return "/condominios/" in normalized


def needs_repair(item: dict[str, Any]) -> bool:
    if str(item.get("source_code") or "").lower() != CODE:
        return False
    if not is_purchase_card(item):
        return False
    price = as_price(item.get("price"))
    return price is None or price <= 0 or price < MIN_PLAUSIBLE_PURCHASE_PRICE


def official_purchase_unavailable(url: str, rules: list[str]) -> bool:
    """Confirm from the public QuintoAndar overview when Compra is explicitly unavailable.

    The generic page contains rental values and marketing amounts elsewhere. This guard
    runs before accepting an implausibly low parsed value, preventing a later R$ amount
    from being mistaken for the purchase price when the overview says `Compra -`.
    """
    if not discovery.robots_allowed(url, rules):
        return False
    status, _final_url, data, _content_type = discovery.fetch(url, timeout=18)
    if status != 200 or not data:
        return False
    text = data.decode("utf-8", errors="replace")
    plain = discovery.clean_text(text) or ""
    return bool(
        re.search(
            r"(?:Valores a partir de|Média das últimas negociações).{0,500}?"
            r"\bCompra\b\s*(?:-|–|—|indispon[ií]vel|não disponível)",
            plain,
            re.I,
        )
    )


def merge_price(item: dict[str, Any], fresh: dict[str, Any]) -> dict[str, Any]:
    updated = dict(item)
    updated["price"] = fresh.get("price")

    # Keep useful fresh fields without erasing existing information when the public
    # page does not expose a field on this request.
    for key in (
        "title",
        "description",
        "location_city",
        "location_state",
        "location_address",
        "property_type",
        "bedrooms",
        "bathrooms",
        "area_sqm",
        "images",
        "source_url",
        "source_portal",
        "source_property_id",
    ):
        value = fresh.get(key)
        if value not in (None, "", []):
            updated[key] = value

    metadata = dict(updated.get("metadata") or {})
    metadata.update(fresh.get("metadata") or {})
    metadata["purchase_price_repair"] = True
    metadata["purchase_price_checked_at"] = discovery.utc_now()
    if fresh.get("price") is None:
        metadata["purchase_price_available"] = False
    else:
        metadata["purchase_price_available"] = True
    updated["metadata"] = metadata
    return updated


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="Discovery JSON to repair in place")
    parser.add_argument(
        "--max-items",
        type=int,
        default=0,
        help="Optional safety cap. 0 means repair every suspicious cached purchase card.",
    )
    args = parser.parse_args()

    path = Path(args.input)
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)

    items = list(payload.get("items") or [])
    targets = [index for index, item in enumerate(items) if isinstance(item, dict) and needs_repair(item)]
    if args.max_items > 0:
        targets = targets[: args.max_items]

    _, rules, robots_ok = discovery.parse_robots(DOMAIN)
    if not robots_ok:
        print(json.dumps({"status": "blocked", "targets": len(targets)}, ensure_ascii=False))
        return 0

    repaired = 0
    cleared_unavailable = 0
    removed_collections = 0
    failed = 0
    removed = set(payload.get("removed_urls") or [])

    for position, index in enumerate(targets, start=1):
        item = items[index]
        url = str(item.get("source_url") or "").strip()
        if not url:
            failed += 1
            continue

        # A neighborhood/collection page can contain counts and average values that
        # look like a property price. It must never be rendered as an individual card.
        if is_collection_page(url):
            removed.add(url)
            items[index] = None
            removed_collections += 1
            continue

        fresh, was_removed = discovery.parse_listing(url, DOMAIN, CODE, NAME, rules)
        if was_removed:
            removed.add(url)
            items[index] = None
            continue
        if not fresh:
            failed += 1
            continue

        previous_price = as_price(item.get("price"))
        new_price = as_price(fresh.get("price"))

        # If the parser still found a tiny amount, confirm whether the official
        # overview explicitly says purchase is unavailable before publishing it.
        if new_price is not None and 0 < new_price < MIN_PLAUSIBLE_PURCHASE_PRICE:
            if official_purchase_unavailable(url, rules):
                fresh["price"] = None
                new_price = None

        items[index] = merge_price(item, fresh)
        if new_price is None:
            cleared_unavailable += 1
        elif previous_price != new_price:
            repaired += 1

        if position % 25 == 0:
            print(
                f"checked={position}/{len(targets)} repaired={repaired} "
                f"unavailable={cleared_unavailable} collections={removed_collections} failed={failed}"
            )
        time.sleep(0.12)

    payload["items"] = [item for item in items if isinstance(item, dict)]
    payload["removed_urls"] = sorted(removed)
    source = payload.get("source")
    if isinstance(source, dict):
        source["price_repair_checked"] = len(targets)
        source["price_repair_updated"] = repaired
        source["price_repair_unavailable"] = cleared_unavailable
        source["price_repair_removed_collections"] = removed_collections
        source["price_repair_failed"] = failed
        source["price_repair_at"] = discovery.utc_now()

    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))

    remaining_numeric_low = 0
    for item in payload["items"]:
        if not isinstance(item, dict) or not needs_repair(item):
            continue
        current = as_price(item.get("price"))
        if current is not None and 0 < current < MIN_PLAUSIBLE_PURCHASE_PRICE:
            remaining_numeric_low += 1

    print(
        json.dumps(
            {
                "status": "ok",
                "targets": len(targets),
                "repaired": repaired,
                "purchase_unavailable": cleared_unavailable,
                "removed_collections": removed_collections,
                "failed": failed,
                "remaining_numeric_low": remaining_numeric_low,
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
