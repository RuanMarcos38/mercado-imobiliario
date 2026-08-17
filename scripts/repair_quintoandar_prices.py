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


def needs_repair(item: dict[str, Any]) -> bool:
    if str(item.get("source_code") or "").lower() != CODE:
        return False
    if not is_purchase_card(item):
        return False
    price = as_price(item.get("price"))
    return price is None or price <= 0 or price < MIN_PLAUSIBLE_PURCHASE_PRICE


def merge_price(item: dict[str, Any], fresh: dict[str, Any]) -> dict[str, Any]:
    updated = dict(item)
    # parse_listing/extract_price explicitly prioritizes Compra/Valor de compra and
    # returns None when the official combined page says purchase is unavailable.
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
    failed = 0
    removed = set(payload.get("removed_urls") or [])

    for position, index in enumerate(targets, start=1):
        item = items[index]
        url = str(item.get("source_url") or "").strip()
        if not url:
            failed += 1
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
        items[index] = merge_price(item, fresh)
        if new_price is None:
            cleared_unavailable += 1
        elif previous_price != new_price:
            repaired += 1

        if position % 25 == 0:
            print(f"checked={position}/{len(targets)} repaired={repaired} unavailable={cleared_unavailable} failed={failed}")
        time.sleep(0.12)

    payload["items"] = [item for item in items if isinstance(item, dict)]
    payload["removed_urls"] = sorted(removed)
    source = payload.get("source")
    if isinstance(source, dict):
        source["price_repair_checked"] = len(targets)
        source["price_repair_updated"] = repaired
        source["price_repair_unavailable"] = cleared_unavailable
        source["price_repair_failed"] = failed
        source["price_repair_at"] = discovery.utc_now()

    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))

    print(
        json.dumps(
            {
                "status": "ok",
                "targets": len(targets),
                "repaired": repaired,
                "purchase_unavailable": cleared_unavailable,
                "failed": failed,
                "remaining": sum(1 for item in payload["items"] if needs_repair(item)),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
