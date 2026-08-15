import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";

export const getSystemHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { data: properties, count: propCount } = await supabase
    .from("properties")
    .select("*", { count: "exact", head: true });

  const { count: leadCount } = await supabase
    .from("leads")
    .select("*", { count: "exact", head: true });

  return {
    status: "healthy",
    timestamp: new Date().toISOString(),
    metrics: {
      total_properties: propCount || 0,
      total_leads: leadCount || 0,
      scanners_active: true,
    },
  };
});
