import { describe, expect, it } from "vitest";

import {
  PUBLIC_SUPABASE_PROJECT_ID,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "../src/integrations/supabase/public-config";

describe("Supabase public configuration", () => {
  it("points MercadoImobi to RM NEGOCIO IMOBILIARIO", () => {
    expect(PUBLIC_SUPABASE_PROJECT_ID).toBe("uwzfgksmnqgaxtscwxow");
    expect(PUBLIC_SUPABASE_URL).toBe("https://uwzfgksmnqgaxtscwxow.supabase.co");
    expect(PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(
      "sb_publishable_mZUNYHM3JeRZXR8vWfVECA_7gCgTp7i",
    );
  });

  it("does not point to legacy or unrelated Supabase projects", () => {
    const publicConfig = `${PUBLIC_SUPABASE_PROJECT_ID} ${PUBLIC_SUPABASE_URL}`;

    expect(publicConfig).not.toContain("rjlqylmwenhzkzmqwris");
    expect(publicConfig).not.toContain("iqrnytsgwaiegddfxfjs");
  });
});
