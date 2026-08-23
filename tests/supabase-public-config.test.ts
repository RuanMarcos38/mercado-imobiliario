import { describe, expect, it } from "vitest";

import {
  PUBLIC_SUPABASE_PROJECT_ID,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "../src/integrations/supabase/public-config";

const FORBIDDEN_PROJECTS = ["uwzfgksmnqgaxtscwxow", "iqrnytsgwaiegddfxfjs"];

describe("Supabase public configuration", () => {
  it("does not bind MercadoImobi to forbidden Supabase projects", () => {
    const publicConfig = `${PUBLIC_SUPABASE_PROJECT_ID} ${PUBLIC_SUPABASE_URL}`;

    for (const projectId of FORBIDDEN_PROJECTS) {
      expect(PUBLIC_SUPABASE_PROJECT_ID).not.toBe(projectId);
      expect(publicConfig).not.toContain(projectId);
    }
  });

  it("keeps the public key aligned with an explicitly configured public endpoint", () => {
    if (!PUBLIC_SUPABASE_URL && !PUBLIC_SUPABASE_PROJECT_ID) {
      expect(PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("");
      return;
    }

    expect(PUBLIC_SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9-]+\.supabase\.co$/);
    expect(PUBLIC_SUPABASE_PROJECT_ID.length).toBeGreaterThan(0);
    expect(PUBLIC_SUPABASE_PUBLISHABLE_KEY.length).toBeGreaterThan(0);
  });
});
