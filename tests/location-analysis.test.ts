import { describe, expect, it } from "vitest";
import {
  buildLocationGeocodeCandidates,
  hasAmenitySignal,
} from "@/lib/location-analysis.functions";

describe("location analysis guardrails", () => {
  it("tries address and neighborhood before falling back to the municipality", () => {
    expect(
      buildLocationGeocodeCandidates({
        address: "Rua Blumenau, 100",
        neighborhood: "América",
        city: "Joinville",
        state: "sc",
      }),
    ).toEqual([
      { query: "Rua Blumenau, 100, América, Joinville, SC, Brasil", precision: "address" },
      { query: "Rua Blumenau, 100, Joinville, SC, Brasil", precision: "address" },
      { query: "América, Joinville, SC, Brasil", precision: "neighborhood" },
      { query: "Joinville, SC, Brasil", precision: "city" },
    ]);
  });

  it("uses a city-center candidate before a broad city-only geocode", () => {
    expect(
      buildLocationGeocodeCandidates({
        city: "Joinville",
        state: "SC",
      }),
    ).toEqual([
      { query: "Centro, Joinville, SC, Brasil", precision: "city" },
      { query: "Joinville, SC, Brasil", precision: "city" },
    ]);
  });

  it("does not mark empty cartographic responses as available infrastructure", () => {
    expect(
      hasAmenitySignal({
        schools: 0,
        health: 0,
        supermarkets: 0,
        parks: 0,
        transit: 0,
      }),
    ).toBe(false);
    expect(
      hasAmenitySignal({
        schools: 1,
        health: 0,
        supermarkets: 0,
        parks: 0,
        transit: 0,
      }),
    ).toBe(true);
  });
});
