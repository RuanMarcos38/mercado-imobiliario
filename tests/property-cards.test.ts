import { describe, expect, it } from "vitest";
import { uniquePropertyCards } from "../src/lib/property-cards";

describe("property cards", () => {
  it("shows one card for a repeated ID or an identical source URL without mutating records", () => {
    const rows = [
      { id: "a", source_url: "https://example.com/imovel/1" },
      { id: "a", source_url: "https://example.com/imovel/1?ref=other" },
      { id: "b", source_url: " https://example.com/imovel/1 " },
      { id: "c", source_url: "https://example.com/imovel/2" },
    ];
    expect(uniquePropertyCards(rows)).toEqual([rows[0], rows[3]]);
    expect(rows).toHaveLength(4);
  });
  it("keeps distinct listings when the source is missing or the URL path differs", () => {
    const rows = [
      { id: "a" },
      { id: "b", source_url: null },
      { id: "c", source_url: "https://example.com/Listing/A" },
      { id: "d", source_url: "https://example.com/Listing/a" },
    ];
    expect(uniquePropertyCards(rows)).toEqual(rows);
  });
});
