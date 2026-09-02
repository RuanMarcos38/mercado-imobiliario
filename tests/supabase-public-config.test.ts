import { describe, expect, it } from "vitest";

import {
  PUBLIC_SUPABASE_PROJECT_ID,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "../src/integrations/supabase/public-config";

const MERCADOIMOBI_PROJECT = "uwzfgksmnqgaxtscwxow";
const MERCADOIMOBI_URL = `https://${MERCADOIMOBI_PROJECT}.supabase.co`;
const FORBIDDEN_PROJECTS = ["iqrnytsgwaiegddfxfjs", "rjlqylmwenhzkzmqwris"];

describe("Supabase public configuration", () => {
  it("keeps MercadoImobi bound to RM NEGOCIO IMOBILIARIO", () => {
    expect(PUBLIC_SUPABASE_PROJECT_ID).toBe(MERCADOIMOBI_PROJECT);
    expect(PUBLIC_SUPABASE_URL).toBe(MERCADOIMOBI_URL);
  });

  it("does not bind MercadoImobi to unrelated Supabase projects", () => {
    const publicConfig = `${PUBLIC_SUPABASE_PROJECT_ID} ${PUBLIC_SUPABASE_URL}`;

    for (const projectId of FORBIDDEN_PROJECTS) {
      expect(PUBLIC_SUPABASE_PROJECT_ID).not.toBe(projectId);
      expect(publicConfig).not.toContain(projectId);
    }
  });

  it("keeps a valid publishable key for the RM NEGOCIO IMOBILIARIO endpoint", () => {
    expect(PUBLIC_SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9-]+\.supabase\.co$/);
    expect(PUBLIC_SUPABASE_PROJECT_ID.length).toBeGreaterThan(0);
    expect(PUBLIC_SUPABASE_PUBLISHABLE_KEY.length).toBeGreaterThan(0);
  });
});
