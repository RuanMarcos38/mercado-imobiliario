import { createHash, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processAttendanceSatisfactionQueue } from "@/lib/attendance-satisfaction.server";

async function authorized(request: Request) {
  const supplied = request.headers.get("x-attendance-survey-key")?.trim() ?? "";
  if (!supplied) return false;

  const db = supabaseAdmin as any;
  const { data, error } = await db
    .from("attendance_survey_job_config")
    .select("token_hash")
    .eq("id", "default")
    .maybeSingle();
  if (error || !data?.token_hash) return false;

  const actual = Buffer.from(createHash("sha256").update(supplied).digest("hex"), "utf8");
  const expected = Buffer.from(String(data.token_hash), "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function handler(request: Request) {
  if (!(await authorized(request))) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await processAttendanceSatisfactionQueue(25);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "attendance_survey_job_failed",
      },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/public/jobs/attendance-surveys")({
  server: {
    handlers: {
      POST: ({ request }) => handler(request),
    },
  },
});
