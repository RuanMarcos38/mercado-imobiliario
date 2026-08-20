/**
 * Security tests against the real MercadoImobi Supabase project using only the
 * public publishable key. Authenticated assertions are enabled when dedicated
 * TEST_USER / TEST_PASS credentials are configured in CI.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  PUBLIC_SUPABASE_URL,
} from "../src/integrations/supabase/public-config";

const PRIVATE_TABLES = [
  "properties",
  "leads",
  "tenants",
  "tenant_members",
  "profiles",
  "property_favorites",
  "search_configurations",
] as const;

function publishableFetch(key: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    if (headers.get("Authorization") === `Bearer ${key}` && key.startsWith("sb_publishable_")) {
      headers.delete("Authorization");
    }
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  };
}

function anonClient(): SupabaseClient {
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    global: { fetch: publishableFetch(PUBLIC_SUPABASE_PUBLISHABLE_KEY) },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isMissingRelation(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205";
}

const HAS_SUPABASE_PUBLIC_KEY = Boolean(PUBLIC_SUPABASE_PUBLISHABLE_KEY);

describe.skipIf(!HAS_SUPABASE_PUBLIC_KEY)("RLS isolation for anonymous visitors", () => {
  let client: SupabaseClient;

  beforeAll(() => {
    client = anonClient();
  });

  for (const table of PRIVATE_TABLES) {
    it(`does not expose ${table} to anonymous visitors`, async () => {
      const { data, error } = await client.from(table).select("*").limit(5);
      if (error) {
        expect(error.message.length).toBeGreaterThan(0);
        return;
      }
      expect(data ?? []).toHaveLength(0);
    });
  }

  it("does not expose the property search index anonymously", async () => {
    const { data, error } = await client.from("property_search_index").select("id").limit(5);
    if (isMissingRelation(error)) {
      expect(data ?? []).toHaveLength(0);
      return;
    }
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("rejects anonymous favorite creation through RLS", async () => {
    const { data, error } = await client
      .from("property_favorites")
      .insert({
        user_id: "00000000-0000-0000-0000-000000000001",
        property_key: "security-test",
        property_snapshot: { source_url: "https://example.invalid/security-test" },
      })
      .select();

    expect(error).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

const TEST_EMAIL = process.env["TEST_USER"];
const TEST_PASSWORD = process.env["TEST_PASS"];

describe.skipIf(!HAS_SUPABASE_PUBLIC_KEY || !TEST_EMAIL || !TEST_PASSWORD)(
  "Authenticated user isolation",
  () => {
    let client: SupabaseClient;
    let userId = "";

    beforeAll(async () => {
      client = anonClient();
      const { data, error } = await client.auth.signInWithPassword({
        email: TEST_EMAIL!,
        password: TEST_PASSWORD!,
      });
      if (error) throw new Error(`Test login failed: ${error.message}`);
      userId = data.user?.id ?? "";
      expect(userId).toBeTruthy();
    });

    it("only returns the signed-in user's favorites", async () => {
      const { data, error } = await client.from("property_favorites").select("user_id").limit(100);
      expect(error).toBeNull();
      for (const row of data ?? []) expect(row.user_id).toBe(userId);
    });

    it("only returns the signed-in user's saved searches", async () => {
      const { data, error } = await client
        .from("search_configurations")
        .select("user_id")
        .limit(100);
      expect(error).toBeNull();
      for (const row of data ?? []) expect(row.user_id).toBe(userId);
    });

    it("can read the shared property index when authenticated", async () => {
      const { data, error } = await client.from("property_search_index").select("id").limit(1);
      if (isMissingRelation(error)) return;
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });
  },
);
