import json
import unittest
from unittest.mock import patch

from public_property_discovery import extract_price, json_ld_objects, schema_address
from sc_property_discovery import rotating, sale_listing, supplement


class RegionalDiscoveryTests(unittest.TestCase):
    def test_installments_and_subsidies_are_not_sale_prices(self):
        self.assertIsNone(extract_price([], "<p>Parcelas a partir de R$ 790,00</p>"))
        self.assertIsNone(extract_price([], "<p>Subsídios de até: R$ 55.000,00</p>"))
        self.assertEqual(extract_price([], "<p>Valor de venda R$ 320.000,00</p>"), 320000)

    def test_nested_property_address_wins_over_publisher_headquarters(self):
        document = {
            "@type": "WebPage",
            "publisher": {"@type": "Organization", "address": {"addressLocality": "Curitiba", "addressRegion": "PR"}},
            "mainEntity": {"@type": "RealEstateListing", "itemOffered": {
                "@type": "Apartment", "address": {
                    "streetAddress": "Rua do anúncio", "addressLocality": "América, Joinville", "addressRegion": "SC"}}},
        }
        html = '<script type="application/ld+json">' + json.dumps(document) + '</script>'
        self.assertEqual(schema_address(json_ld_objects(html)), ("Rua do anúncio", "Joinville", "SC"))

    def test_publisher_address_is_not_used_as_property_location(self):
        self.assertEqual(schema_address([{"@type": "Organization", "address": {
            "addressLocality": "Joinville", "addressRegion": "SC"}}]), (None, None, None))

    def test_sale_detail_boundary_rejects_rent_and_other_states(self):
        self.assertTrue(sale_listing("https://www.chavesnamao.com.br/imovel/casa-a-venda-sc-joinville/id-123/"))
        self.assertFalse(sale_listing("https://www.chavesnamao.com.br/imovel/casa-para-alugar-sc-joinville/id-123/"))
        self.assertFalse(sale_listing("https://www.chavesnamao.com.br/imovel/casa-a-venda-pr-curitiba/id-123/"))
        self.assertFalse(sale_listing("https://www.chavesnamao.com.br/imoveis-a-venda/sc-joinville/"))

    def test_rotating_batches_reach_all_candidates(self):
        first, cursor = rotating(["a", "b", "c", "d"], 0, 2)
        second, cursor = rotating(["a", "b", "c", "d"], cursor, 2)
        self.assertEqual(first + second, ["a", "b", "c", "d"])
        self.assertEqual(cursor, 0)

    def test_blocked_source_keeps_previous_snapshot(self):
        payload = {"source": {"code": "chavesnamao"}, "items": [{"source_url": "https://example.com/existing"}]}
        with patch("sc_property_discovery.parse_robots", return_value=([], [], False)):
            result = supplement(payload, "chavesnamao", "Chaves na Mão", "chavesnamao.com.br", 20)
        self.assertEqual(result["items"], payload["items"])
        self.assertNotIn("sc_checked_at", result["source"])


if __name__ == "__main__":
    unittest.main()
