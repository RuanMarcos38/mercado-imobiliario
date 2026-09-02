import { describe, expect, it } from "vitest";

import {
  PUBLIC_SUPABASE_PROJECT_ID,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "../src/integrations/supabase/public-config";

const env = import.meta.env as Record<string, string | undefined>;
const configuredProject = String(env.VITE_SUPABASE_PROJECT_ID ?? "").trim();
const configuredUrl = String(env.VITE_SUPABASE_URL ?? "").trim();
const forbiddenProjects = ["uwzfgksmnqga" + "xtscwxow", "iqrnytsgwaie" + "gddfxfjs"];

describe("Supabase public configuration", () => {
  it("uses the exclusive MercadoImobi project provided by the environment", () => {
    expect(configuredProject).toMatch(/^[a-z0-9]{20}$/);
    expect(PUBLIC_SUPABASE_PROJECT_ID).toBe(configuredProject);
    expect(PUBLIC_SUPABASE_URL).toBe(configuredUrl || `https://${configuredProject}.supabase.co`);
  });

  it("does not bind MercadoImobi to reserved Supabase projects", () => {
    for (const projectId of forbiddenProjects) {
      expect(PUBLIC_SUPABASE_PROJECT_ID).not.toBe(projectId);
      expect(PUBLIC_SUPABASE_URL).not.toContain(projectId);
    }
  });

  it("requires a valid publishable key for the exclusive MercadoImobi endpoint", () => {
    expect(PUBLIC_SUPABASE_URL).toMatch(/^https:\/\/[a-z0-9-]+\.supabase\.co$/);
    expect(PUBLIC_SUPABASE_PUBLISHABLE_KEY).toMatch(/^sb_publishable_/);
  });
});
