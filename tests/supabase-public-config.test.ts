import { describe, expect, it } from "vitest";

import {
  PUBLIC_SUPABASE_PROJECT_ID,
  PUBLIC_SUPABASE_URL,
} from "../src/integrations/supabase/public-config";

describe("Supabase public configuration", () => {
  it("points MercadoImobi to its own Supabase project", () => {
    expect(PUBLIC_SUPABASE_PROJECT_ID).toBe("rjlqylmwenhzkzmqwris");
    expect(PUBLIC_SUPABASE_URL).toBe("https://rjlqylmwenhzkzmqwris.supabase.co");
  });

  it("does not point to protected unrelated Supabase projects", () => {
    const publicConfig = `${PUBLIC_SUPABASE_PROJECT_ID} ${PUBLIC_SUPABASE_URL}`;

    expect(publicConfig).not.toContain("uwzfgksmnqgaxtscwxow");
    expect(publicConfig).not.toContain("iqrnytsgwaiegddfxfjs");
  });
});
