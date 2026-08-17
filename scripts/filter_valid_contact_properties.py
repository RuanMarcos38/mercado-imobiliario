#!/usr/bin/env python3
"""Keep only public market listings with a structurally valid Brazilian contact phone.

CAIXA is intentionally outside this public-discovery snapshot. Validation is strict:
DDD + landline/mobile number, optionally prefixed by country code 55. Short codes,
0800/0300, dates, IDs and malformed numbers are rejected.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any

VALID_DDDS = {
    "11","12","13","14","15","16","17","18","19",
    "21","22","24","27","28",
    "31","32","33","34","35","37","38",
    "41","42","43","44","45","46","47","48","49",
    "51","53","54","55",
    "61","62","63","64","65","66","67","68","69",
    "71","73","74","75","77","79",
    "81","82","83","84","85","86","87","88","89",
    "91","92","93","94","95","96","97","98","99",
}


def normalize_br_phone(value: Any) -> str | None:
    digits = re.sub(r"\D", "", str(value or ""))
    if digits.startswith("55") and len(digits) in {12, 13}:
        digits = digits[2:]
    if len(digits) not in {10, 11}:
        return None
    if digits[:2] not in VALID_DDDS:
        return None
    subscriber = digits[2:]
    if len(set(digits)) <= 2:
        return None
    if len(digits) == 11:
        if not subscriber.startswith("9") or subscriber[1] not in "6789":
            return None
    else:
        if subscriber[0] not in "2345":
            return None
    return f"55{digits}"


def valid_contact(item: dict[str, Any]) -> str | None:
    for field in ("contact_whatsapp", "contact_phone"):
        normalized = normalize_br_phone(item.get(field))
        if normalized:
            return normalized
    return None


def filter_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    kept: list[dict[str, Any]] = []
    rejected_urls: list[str] = []

    for raw in items:
        if not isinstance(raw, dict):
            continue
        normalized = valid_contact(raw)
        if not normalized:
            url = raw.get("source_url")
            if isinstance(url, str) and url:
                rejected_urls.append(url)
            continue
        raw["contact_phone"] = normalized
        if normalize_br_phone(raw.get("contact_whatsapp")):
            raw["contact_whatsapp"] = normalize_br_phone(raw.get("contact_whatsapp"))
        metadata = raw.get("metadata") if isinstance(raw.get("metadata"), dict) else {}
        metadata["contact_phone_valid"] = True
        metadata["contact_phone_e164"] = normalized
        raw["metadata"] = metadata
        kept.append(raw)

    existing_removed = payload.get("removed_urls") if isinstance(payload.get("removed_urls"), list) else []
    payload["items"] = kept
    payload["removed_urls"] = list(dict.fromkeys([str(url) for url in existing_removed if url] + rejected_urls))

    source = payload.get("source")
    if isinstance(source, dict):
        source["found_count"] = len(kept)
        source["filtered_invalid_contact"] = len(rejected_urls)
        if len(kept) == 0 and source.get("status") == "active":
            source["status"] = "limited"

    return payload, len(rejected_urls)


def self_test() -> None:
    valid = ["11996630900", "+55 (11) 99663-0900", "4133171700", "5521937749518"]
    invalid = ["", "00000000", "40204122", "58012473", "08008007090", "0905202318", "11111111111", "1015338897"]
    assert all(normalize_br_phone(value) for value in valid)
    assert not any(normalize_br_phone(value) for value in invalid)
    print("valid-contact self-test: OK")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return 0
    if not args.input:
        parser.error("--input is required unless --self-test is used")

    with open(args.input, encoding="utf-8") as handle:
        payload = json.load(handle)
    if not isinstance(payload, dict):
        raise SystemExit("snapshot must be a JSON object")

    filtered, rejected = filter_payload(payload)
    with open(args.input, "w", encoding="utf-8") as handle:
        json.dump(filtered, handle, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps({"file": args.input, "kept": len(filtered.get("items") or []), "rejected_invalid_contact": rejected}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
