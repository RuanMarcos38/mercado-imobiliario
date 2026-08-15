import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Schema for property data from n8n
const propertySchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  price: z.number(),
  location_address: z.string().nullable().optional(),
  location_city: z.string().nullable().optional(),
  location_state: z.string().nullable().optional(),
  source_portal: z.string().nullable().optional(),
  source_url: z.string().url(),
  images: z.array(z.string()).nullable().optional(),
  property_type: z.string().nullable().optional(),
  tenant_id: z.string().uuid(), // Important for isolation
});

const handlers = {
  POST: async ({ request }: { request: Request }) => {
    const apiKey = request.headers.get("x-n8n-api-key");
    const secret = process.env["N8N_WEBHOOK_SECRET"];

    // Basic auth check for n8n
    if (!secret) {
      return new Response(JSON.stringify({ error: "n8n integration not configured" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!apiKey || apiKey !== secret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
      const body = await request.json();
      const payload = propertySchema.parse(body);

      // Resolve the organization (tenant) that owns this record.
      // The payload may carry either a tenant id or a user id.
      let tenantId: string | null = null;
      let ownerId: string | null = null;

      const { data: tenantRow } = await supabase
        .from("tenants")
        .select("id")
        .eq("id", payload.tenant_id)
        .maybeSingle();

      if (tenantRow) {
        tenantId = tenantRow.id;
      } else {
        const { data: profileRow } = await supabase
          .from("profiles")
          .select("id, tenant_id")
          .eq("id", payload.tenant_id)
          .maybeSingle();

        if (!profileRow) {
          return new Response(
            JSON.stringify({ error: "tenant_id não corresponde a nenhuma organização ou usuário" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        ownerId = profileRow.id;
        tenantId = profileRow.tenant_id;
      }

      // Insert property linked to specific tenant
      const { error } = await supabase.from("properties").insert({
        title: payload.title,
        description: payload.description ?? null,
        price: payload.price,
        location_address: payload.location_address ?? null,
        location_city: payload.location_city ?? null,
        location_state: payload.location_state ?? null,
        source_portal: payload.source_portal ?? null,
        source_url: payload.source_url,
        images: payload.images ?? null,
        property_type: payload.property_type ?? null,
        tenant_id: tenantId,
        owner_id: ownerId,
        is_verified: false,
        anti_fraud_score: null,
      });

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
  GET: async () =>
    new Response(JSON.stringify({ status: "ok", method: "POST expected" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
};

export const Route = createFileRoute("/api/public/hooks/n8n-webhook")({
  server: { handlers },
});
