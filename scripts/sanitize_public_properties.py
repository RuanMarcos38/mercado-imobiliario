#!/usr/bin/env python3
"""Remove non-real-estate records from MercadoImobi public discovery snapshots.

The public discovery crawler intentionally reads only public pages, but mixed-content
portals (especially classifieds and editorial sections) can expose vehicle, product,
service, or news pages in the same sitemap. This sanitizer is the final allow-list
boundary before data is published to the platform.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from typing import Any

REAL_ESTATE_TERMS = (
    "imovel", "imoveis", "apartamento", "apartamentos", "casa", "casas",
    "sobrado", "sobrados", "terreno", "terrenos", "lote", "lotes", "loteamento",
    "cobertura", "studio", "loft", "kitnet", "flat", "condominio", "condominios",
    "edificio", "residencial", "residence", "empreendimento", "empreendimentos",
    "imobiliaria", "imobiliario", "sala comercial", "loja comercial", "galpao",
    "predio", "chacara", "sitio", "fazenda", "dormitorio", "quarto", "banheiro",
    "real estate", "property for sale", "property for rent", "apartment", "house",
)

ALLOWED_PROPERTY_TYPES = (
    "imovel", "apartamento", "casa", "sobrado", "terreno", "lote", "cobertura",
    "studio", "loft", "kitnet", "flat", "condominio", "residencial", "comercial",
    "sala", "galpao", "predio", "chacara", "sitio", "fazenda", "empreendimento",
)

# Strong negatives are intentionally focused on categories that cannot be a property.
# They are evaluated primarily against title + URL so incidental words in long page
# descriptions do not wrongly remove a legitimate property.
NON_PROPERTY_TERMS = (
    "honda", "toyota", "volkswagen", "chevrolet", "fiat", "hyundai", "renault",
    "nissan", "ford", "jeep", "bmw", "mercedes", "audi", "kia", "peugeot",
    "citroen", "chery", "byd", "gwm", "haval", "caoa", "mitsubishi", "suzuki",
    "civic", "corolla", "taos", "t-cross", "nivus", "polo", "gol ", "onix",
    "tracker", "compass", "renegade", "hilux", "ranger", "strada", "toro",
    "carro", "carros", "automovel", "veiculo", "veiculos", "motocicleta", "moto ",
    "motos ", "suv", "sedan", "hatch", "picape", "pickup", "caminhao", "caminhoes",
    "motorcycle", "vehicle", "automotive", "comparativo completo", "melhor esportivo",
    "mercado de motos", "recorde em", "test drive", "ficha tecnica", "ficha-tecnica",
    "iphone", "smartphone", "celular", "notebook", "laptop", "televisao", "smart tv",
    "geladeira", "refrigerador", "maquina de lavar", "micro-ondas", "videogame",
    "playstation", "xbox", "tenis masculino", "tenis feminino", "camiseta", "perfume",
    "vaga de emprego", "emprego", "curso online", "receita de", "horoscopo",
)

REAL_ESTATE_SCHEMA_TERMS = (
    "realestate", "realestatelisting", "apartment", "house", "residence",
    "singlefamilyresidence", "accommodation", "lodgingbusiness",
)


def normalize(value: Any) -> str:
    text = str(value or "").lower()
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return re.sub(r"\s+", " ", text).strip()


def has_term(text: str, terms: tuple[str, ...]) -> bool:
    padded = f" {text} "
    return any(term in padded for term in terms)


def property_signal_score(item: dict[str, Any]) -> int:
    title = normalize(item.get("title"))
    url = normalize(item.get("source_url"))
    description = normalize(item.get("description"))
    property_type = normalize(item.get("property_type"))
    metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    schema_types = normalize(metadata.get("schema_types"))

    score = 0
    if has_term(f"{title} {url}", REAL_ESTATE_TERMS):
        score += 4
    if property_type and has_term(property_type, ALLOWED_PROPERTY_TYPES):
        score += 4
    if has_term(schema_types, REAL_ESTATE_SCHEMA_TERMS):
        score += 5
    if has_term(description[:1200], REAL_ESTATE_TERMS):
        score += 1

    bedrooms = item.get("bedrooms")
    bathrooms = item.get("bathrooms")
    area = item.get("area_sqm")
    address = normalize(item.get("location_address"))
    city = normalize(item.get("location_city"))
    if bedrooms not in (None, ""):
        score += 1
    if bathrooms not in (None, ""):
        score += 1
    if area not in (None, ""):
        score += 1
    if address or city:
        score += 1
    return score


def is_real_estate(item: dict[str, Any]) -> bool:
    # CAIXA records come from the official property list and are not produced by
    # this public crawler, but accepting them here makes the predicate safe to reuse.
    if normalize(item.get("listing_market")) == "caixa" or item.get("is_auction") is True:
        return True

    title = normalize(item.get("title"))
    url = normalize(item.get("source_url"))
    property_type = normalize(item.get("property_type"))
    title_url = f"{title} {url}"

    # A strong automotive/product/news match is a hard rejection unless the record
    # carries an explicit, recognized property type. This prevents pages such as
    # "Honda Civic...", "Haval H6..." and motorcycle news from entering the index.
    if has_term(title_url, NON_PROPERTY_TERMS) and not has_term(property_type, ALLOWED_PROPERTY_TYPES):
        return False

    return property_signal_score(item) >= 4


def sanitize_payload(payload: dict[str, Any]) -> tuple[dict[str, Any], int]:
    items = payload.get("items") if isinstance(payload.get("items"), list) else []
    kept: list[dict[str, Any]] = []
    rejected_urls: list[str] = []

    for raw in items:
        if not isinstance(raw, dict):
            continue
        if is_real_estate(raw):
            kept.append(raw)
        else:
            url = raw.get("source_url")
            if isinstance(url, str) and url:
                rejected_urls.append(url)

    existing_removed = payload.get("removed_urls") if isinstance(payload.get("removed_urls"), list) else []
    removed_urls = list(dict.fromkeys([str(url) for url in existing_removed if url] + rejected_urls))
    payload["items"] = kept
    payload["removed_urls"] = removed_urls

    source = payload.get("source")
    if isinstance(source, dict):
        source["found_count"] = len(kept)
        source["filtered_non_properties"] = len(rejected_urls)

    return payload, len(rejected_urls)


def self_test() -> None:
    valid = [
        {"title": "Edifício Vivendas do Salso II - Porto Alegre", "source_url": "https://example.com/condominio/vivendas-salso", "property_type": "Apartamento"},
        {"title": "Apartamento com 2 quartos à venda em Joinville", "source_url": "https://example.com/imovel/123", "bedrooms": 2, "area_sqm": 72},
        {"title": "Condomínio Way Barra Bonita, Recreio - Rio de Janeiro", "source_url": "https://example.com/condominio/way-barra-bonita", "area_sqm": 93},
        {"title": "Terreno à venda no Centro", "source_url": "https://example.com/terreno/889", "location_city": "Joinville"},
    ]
    invalid = [
        {"title": "Haval H6 HEV ou Volkswagen Taos? Comparativo completo", "source_url": "https://example.com/noticias/auto/123", "price": 103, "images": ["x"]},
        {"title": "Honda Civic Si 2008: o melhor esportivo nacional?", "source_url": "https://example.com/carros/honda-civic", "price": 3, "images": ["x"]},
        {"title": "Mercado de motos cresce 15% e emira novo recorde em 2026", "source_url": "https://example.com/noticias/motos", "price": 550, "images": ["x"]},
        {"title": "iPhone 17 Pro usado em excelente estado", "source_url": "https://example.com/anuncio/998", "price": 5000, "images": ["x"]},
    ]
    assert all(is_real_estate(item) for item in valid), "valid real-estate fixture was rejected"
    assert not any(is_real_estate(item) for item in invalid), "non-property fixture was accepted"
    print("sanitizer self-test: OK")


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

    sanitized, rejected = sanitize_payload(payload)
    with open(args.input, "w", encoding="utf-8") as handle:
        json.dump(sanitized, handle, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps({"file": args.input, "kept": len(sanitized.get("items") or []), "rejected": rejected}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
