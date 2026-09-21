import { createFileRoute } from "@tanstack/react-router";
import { apiJson, authenticateApiRequest } from "@/lib/api-auth.server";
import { z } from "zod";

// Schema for property data from n8n
const propertySchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  price: z.coerce.number(),
  location_address: z.string().nullable().optional(),
  location_city: z.string().nullable().optional(),
  location_state: z.string().nullable().optional(),
  source_portal: z.string().nullable().optional(),
  source_url: z.string().url(),
  images: z.array(z.string()).nullable().optional(),
  property_type: z.string().nullable().optional(),
  tenant_id: z.string().uuid().optional(),
});

function normalizePayload(body: Record<string, unknown>) {
  return {
    ...body,
    source_url: body.source_url ?? body.sourceUrl ?? body.url,
    location_address: body.location_address ?? body.address,
    location_city: body.location_city ?? body.city,
    location_state: body.location_state ?? body.state,
    source_portal: body.source_portal ?? body.sourcePortal,
    property_type: body.property_type ?? body.propertyType,
    tenant_id: body.tenant_id ?? body.tenantId,
  };
}

const handlers = {
  POST: async ({ request }: { request: Request }) => {
    const principal = await authenticateApiRequest(request);
    const hasBearerToken = /^Bearer\s+/i.test(request.headers.get("authorization") ?? "");
    const apiKey = request.headers.get("x-n8n-api-key");
    const secret = process.env["N8N_WEBHOOK_SECRET"]?.trim();

    if (!principal) {
      if (hasBearerToken) {
        return apiJson({ error: "Unauthorized" }, 401);
      }
      if (!secret) {
        return apiJson({ error: "n8n integration not configured" }, 503);
      }
      if (!apiKey || apiKey !== secret) {
        return apiJson({ error: "Unauthorized" }, 401);
      }
    }

    try {
      const { supabaseAdmin: supabase } = await import("@/integrations/supabase/client.server");
      const body = await request.json();
      const payload = propertySchema.parse(normalizePayload(body));

      // Resolve the organization (tenant) that owns this record.
      // Bearer API tokens are preferred because they already identify the user and tenant.
      let tenantId: string | null = principal?.tenantId ?? null;
      let ownerId: string | null = principal?.userId ?? null;

      if (!tenantId) {
        if (!payload.tenant_id) {
          return apiJson({ error: "tenant_id is required without bearer token" }, 422);
        }

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
            return apiJson(
              { error: "tenant_id nao corresponde a nenhuma organizacao ou usuario" },
              400,
            );
          }

          ownerId = profileRow.id;
          tenantId = profileRow.tenant_id;
        }
      }

      // Insert property linked to specific tenant
      const { error } = await supabase.from("properties").insert({
        title: payload.title,
        description: payload.description ?? null,
        price: payload.price,
        location_address: payload.location_address ?? null,
        location_city: payload.location_city ?? null,
        location_state: payload.location_state ?? null,
        source_portal: payload.source_portal ?? "n8n",
        source_url: payload.source_url,
        images: payload.images ?? null,
        property_type: payload.property_type ?? null,
        tenant_id: tenantId,
        owner_id: ownerId,
        is_verified: false,
        anti_fraud_score: null,
      });

      if (error) throw error;

      return apiJson({ success: true, data: { tenantId, ownerId } });
    } catch (err: any) {
      return apiJson({ error: err.message }, 400);
    }
  },
  GET: async () => apiJson({ status: "ok", method: "POST expected" }),
};

export const Route = createFileRoute("/api/public/hooks/n8n-webhook")({
  server: { handlers },
});
