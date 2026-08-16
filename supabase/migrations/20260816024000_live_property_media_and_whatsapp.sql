-- MercadoImobi: property photos, hourly CAIXA refresh and WhatsApp atendimento.
-- This migration belongs only to the Casa Conectada / MercadoImobi database.

UPDATE public.property_search_index
SET images = ARRAY[
  'https://venda-imoveis.caixa.gov.br/fotos/F' || (metadata->>'official_id') || '21.jpg'
]::text[]
WHERE metadata->>'source' = 'caixa'
  AND NULLIF(metadata->>'official_id', '') IS NOT NULL
  AND (images IS NULL OR COALESCE(array_length(images, 1), 0) = 0);

CREATE OR REPLACE FUNCTION public.refresh_caixa_property_index()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_payload jsonb;
  v_source_count integer;
  v_staged integer;
  v_upserted integer;
  v_removed integer;
  v_generated_at text;
BEGIN
  SELECT ((extensions.http_get(
    'https://raw.githubusercontent.com/RuanMarcos38/mercado-imobiliario/data-cache/caixa-properties.json'
  )).content)::jsonb
  INTO v_payload;

  IF v_payload IS NULL OR jsonb_typeof(v_payload->'items') <> 'array' THEN
    RAISE EXCEPTION 'CAIXA snapshot is invalid';
  END IF;

  v_source_count := jsonb_array_length(v_payload->'items');
  v_generated_at := v_payload->>'generated_at';
  IF v_source_count < 1000 THEN
    RAISE EXCEPTION 'CAIXA snapshot is unexpectedly small: %', v_source_count;
  END IF;

  CREATE TEMPORARY TABLE tmp_caixa_refresh ON COMMIT DROP AS
  SELECT
    item->>'title' AS title,
    NULLIF(item->>'description', '') AS description,
    NULLIF(item->>'price', '')::numeric AS price,
    NULLIF(item->>'location_city', '') AS location_city,
    NULLIF(item->>'location_state', '') AS location_state,
    NULLIF(item->>'location_address', '') AS location_address,
    NULLIF(item->>'property_type', '') AS property_type,
    NULLIF(item->>'bedrooms', '')::integer AS bedrooms,
    NULLIF(item->>'bathrooms', '')::integer AS bathrooms,
    NULLIF(item->>'area_sqm', '')::numeric AS area_sqm,
    CASE
      WHEN jsonb_typeof(item->'images') = 'array' AND jsonb_array_length(item->'images') > 0
        THEN ARRAY(SELECT jsonb_array_elements_text(item->'images'))
      WHEN NULLIF(item->'metadata'->>'official_id', '') IS NOT NULL
        THEN ARRAY[
          'https://venda-imoveis.caixa.gov.br/fotos/F' ||
          (item->'metadata'->>'official_id') || '21.jpg'
        ]::text[]
      ELSE NULL::text[]
    END AS images,
    item->>'source_url' AS source_url,
    COALESCE(NULLIF(item->>'source_portal', ''), 'Imóveis CAIXA') AS source_portal,
    1.0::numeric AS anti_fraud_score,
    true AS is_verified,
    COALESCE(NULLIF(item->>'scanned_at', '')::timestamptz, now()) AS scanned_at,
    COALESCE(item->'metadata', '{}'::jsonb) AS metadata
  FROM jsonb_array_elements(v_payload->'items') AS item
  WHERE item->>'source_url' LIKE 'https://venda-imoveis.caixa.gov.br/%';

  SELECT count(*) INTO v_staged FROM tmp_caixa_refresh;
  IF v_staged < 1000 THEN
    RAISE EXCEPTION 'CAIXA normalized snapshot is unexpectedly small: %', v_staged;
  END IF;

  INSERT INTO public.property_search_index (
    title, description, price, location_city, location_state, location_address,
    property_type, bedrooms, bathrooms, area_sqm, images, source_url, source_portal,
    anti_fraud_score, is_verified, scanned_at, metadata
  )
  SELECT
    title, description, price, location_city, location_state, location_address,
    property_type, bedrooms, bathrooms, area_sqm, images, source_url, source_portal,
    anti_fraud_score, is_verified, scanned_at, metadata
  FROM tmp_caixa_refresh
  ON CONFLICT (source_url) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    price = excluded.price,
    location_city = excluded.location_city,
    location_state = excluded.location_state,
    location_address = excluded.location_address,
    property_type = excluded.property_type,
    bedrooms = excluded.bedrooms,
    bathrooms = excluded.bathrooms,
    area_sqm = excluded.area_sqm,
    images = excluded.images,
    source_portal = excluded.source_portal,
    anti_fraud_score = excluded.anti_fraud_score,
    is_verified = excluded.is_verified,
    scanned_at = excluded.scanned_at,
    metadata = excluded.metadata;
  GET DIAGNOSTICS v_upserted = ROW_COUNT;

  DELETE FROM public.property_search_index target
  WHERE target.source_portal = 'Imóveis CAIXA'
    AND NOT EXISTS (
      SELECT 1
      FROM tmp_caixa_refresh staged
      WHERE staged.source_url = target.source_url
    );
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'source_count', v_source_count,
    'staged', v_staged,
    'upserted', v_upserted,
    'removed', v_removed,
    'snapshot_generated_at', v_generated_at,
    'refreshed_at', now()
  );
END;
$$;

DO $$
DECLARE
  existing_job bigint;
BEGIN
  SELECT jobid INTO existing_job
  FROM cron.job
  WHERE jobname = 'refresh-caixa-property-index'
  LIMIT 1;

  IF existing_job IS NOT NULL THEN
    PERFORM cron.unschedule(existing_job);
  END IF;

  PERFORM cron.schedule(
    'refresh-caixa-property-index',
    '45 * * * *',
    'select public.refresh_caixa_property_index();'
  );
END;
$$;

CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  instance_name text NOT NULL,
  display_name text,
  phone_number text,
  status text NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected', 'connecting', 'connected', 'error')),
  last_connected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id),
  UNIQUE (instance_name)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  assigned_user_id uuid,
  phone_e164 text NOT NULL,
  contact_name text,
  avatar_url text,
  last_message text,
  last_message_at timestamptz,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_e164)
);

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  external_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type text NOT NULL DEFAULT 'text',
  body text,
  media_url text,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'received', 'failed')),
  sender_name text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_external_unique
  ON public.whatsapp_messages (tenant_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_conversations_tenant_last_idx
  ON public.whatsapp_conversations (tenant_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS whatsapp_messages_conversation_sent_idx
  ON public.whatsapp_messages (conversation_id, sent_at ASC);

ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_connections_select ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_select ON public.whatsapp_connections
FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS whatsapp_connections_insert ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_insert ON public.whatsapp_connections
FOR INSERT TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id) AND owner_user_id = auth.uid());
DROP POLICY IF EXISTS whatsapp_connections_update ON public.whatsapp_connections;
CREATE POLICY whatsapp_connections_update ON public.whatsapp_connections
FOR UPDATE TO authenticated USING (public.is_tenant_member(tenant_id))
WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS whatsapp_conversations_select ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_select ON public.whatsapp_conversations
FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS whatsapp_conversations_insert ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_insert ON public.whatsapp_conversations
FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS whatsapp_conversations_update ON public.whatsapp_conversations;
CREATE POLICY whatsapp_conversations_update ON public.whatsapp_conversations
FOR UPDATE TO authenticated USING (public.is_tenant_member(tenant_id))
WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS whatsapp_messages_select ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_select ON public.whatsapp_messages
FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS whatsapp_messages_insert ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_insert ON public.whatsapp_messages
FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));
DROP POLICY IF EXISTS whatsapp_messages_update ON public.whatsapp_messages;
CREATE POLICY whatsapp_messages_update ON public.whatsapp_messages
FOR UPDATE TO authenticated USING (public.is_tenant_member(tenant_id))
WITH CHECK (public.is_tenant_member(tenant_id));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'property_search_index'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.property_search_index;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'whatsapp_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
  END IF;
END;
$$;
