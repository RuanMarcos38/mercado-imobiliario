/**
 * Teste E2E de isolamento multi-tenant.
 *
 * Roda contra o banco real usando a chave publishable (papel `anon`) e, quando
 * credenciais de teste estão disponíveis, também como usuário autenticado.
 *
 * O que é verificado:
 * 1. Visitante anônimo não consegue ler nenhuma tabela com escopo de tenant.
 * 2. Visitante anônimo não consegue gravar em tabelas com escopo de tenant.
 * 3. Usuário autenticado só vê linhas do seu próprio `tenant_id`.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env", quiet: true });

const SUPABASE_URL: string | undefined =
  process.env["VITE_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
const SUPABASE_KEY: string | undefined =
  process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];

/** Tabelas cujo acesso deve ser sempre restrito à organização do usuário. */
const TENANT_SCOPED_TABLES = [
  "properties",
  "leads",
  "tenants",
  "tenant_members",
  "profiles",
] as const;

function anonClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error(
      "VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY são obrigatórios para o teste de isolamento.",
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

describe("Isolamento multi-tenant (anônimo)", () => {
  let client: SupabaseClient;

  beforeAll(() => {
    client = anonClient();
  });

  for (const table of TENANT_SCOPED_TABLES) {
    it(`nega leitura anônima em ${table}`, async () => {
      const { data, error } = await client.from(table).select("*").limit(5);

      // Aceitamos duas formas de bloqueio: erro de permissão/RLS ou zero linhas.
      if (error) {
        expect(error.message.length).toBeGreaterThan(0);
        return;
      }
      expect(data ?? []).toHaveLength(0);
    });
  }

  it("nega gravação anônima em leads", async () => {
    const { data, error } = await client
      .from("leads")
      .insert({ client_name: "teste-isolamento", status: "novo" })
      .select();

    expect(error, "insert anônimo deveria ser recusado pela RLS").not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("nega gravação anônima em properties", async () => {
    const { data, error } = await client
      .from("properties")
      .insert({
        title: "teste-isolamento",
        price: 1,
        source_url: `https://exemplo.test/${Date.now()}`,
      })
      .select();

    expect(error, "insert anônimo deveria ser recusado pela RLS").not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});

const TEST_EMAIL: string | undefined = process.env["TEST_USER"];
const TEST_PASSWORD: string | undefined = process.env["TEST_PASS"];

describe.skipIf(!TEST_EMAIL || !TEST_PASSWORD)(
  "Isolamento multi-tenant (usuário autenticado)",
  () => {
    let client: SupabaseClient;
    let tenantId: string | null = null;

    beforeAll(async () => {
      client = anonClient();
      const { data, error } = await client.auth.signInWithPassword({
        email: TEST_EMAIL!,
        password: TEST_PASSWORD!,
      });
      if (error) throw new Error(`Login de teste falhou: ${error.message}`);

      const userId = data.user?.id;
      expect(userId, "sessão de teste sem usuário").toBeTruthy();

      const { data: member, error: memberError } = await client
        .from("tenant_members")
        .select("tenant_id")
        .eq("user_id", userId!)
        .limit(1)
        .maybeSingle();

      if (memberError) throw new Error(memberError.message);
      tenantId = (member as { tenant_id?: string } | null)?.tenant_id ?? null;
      expect(tenantId, "usuário de teste sem organização vinculada").toBeTruthy();
    });

    it("só retorna imóveis do próprio tenant", async () => {
      const { data, error } = await client.from("properties").select("id, tenant_id").limit(100);

      expect(error).toBeNull();
      for (const row of data ?? []) {
        expect((row as { tenant_id: string }).tenant_id).toBe(tenantId);
      }
    });

    it("só retorna leads do próprio tenant", async () => {
      const { data, error } = await client.from("leads").select("id, tenant_id").limit(100);

      expect(error).toBeNull();
      for (const row of data ?? []) {
        expect((row as { tenant_id: string }).tenant_id).toBe(tenantId);
      }
    });

    it("só enxerga membros da própria organização", async () => {
      const { data, error } = await client.from("tenant_members").select("tenant_id").limit(100);

      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
      for (const row of data ?? []) {
        expect((row as { tenant_id: string }).tenant_id).toBe(tenantId);
      }
    });
  },
);
