from pathlib import Path

server = Path('src/lib/prospect-radar.server.ts')
text = server.read_text()
old = '''type CacheState = {\n  snapshot: ProspectRadarSnapshot | null;\n  running: Promise<ProspectRadarSnapshot> | null;\n};'''
new = '''type CacheState = {\n  snapshot: ProspectRadarSnapshot | null;\n  running: Promise<ProspectRadarSnapshot> | null;\n  timerStarted: boolean;\n  timer: ReturnType<typeof setTimeout> | null;\n};'''
if text.count(old) != 1:
    raise SystemExit('CacheState marker mismatch')
text = text.replace(old, new, 1)
old = '''    globalState.__mercadoimobiProspectRadar = { snapshot: null, running: null };'''
new = '''    globalState.__mercadoimobiProspectRadar = {\n      snapshot: null,\n      running: null,\n      timerStarted: false,\n      timer: null,\n    };'''
if text.count(old) != 1:
    raise SystemExit('cache init marker mismatch')
text = text.replace(old, new, 1)
old = '''export function getScheduledProspectRadarSnapshot() {\n  return state().snapshot;\n}\n'''
new = '''export function getScheduledProspectRadarSnapshot() {\n  return state().snapshot;\n}\n\nexport function ensureProspectRadarLoop() {\n  const cache = state();\n  if (cache.timerStarted) return;\n  cache.timerStarted = true;\n\n  const schedule = (delayMs: number) => {\n    cache.timer = setTimeout(async () => {\n      try {\n        await runScheduledProspectRadar();\n      } catch (error) {\n        console.error(\n          "[prospect-radar] automatic sweep failed",\n          error instanceof Error ? error.message : String(error),\n        );\n      } finally {\n        schedule(60 * 60 * 1000);\n      }\n    }, delayMs);\n    cache.timer.unref?.();\n  };\n\n  // Primeira execução logo após o processo Node carregar as rotas; depois repete a cada 1 hora.\n  schedule(5_000);\n}\n\nexport function getProspectRadarPublicStatus() {\n  const cache = state();\n  const snapshot = cache.snapshot;\n  return {\n    schedulerActive: cache.timerStarted,\n    running: Boolean(cache.running),\n    searchedAt: snapshot?.searchedAt ?? null,\n    nextRunAt: snapshot?.nextRunAt ?? null,\n    leads: snapshot?.result.leads.length ?? 0,\n    hot: snapshot?.result.leads.filter((lead) => lead.intentStage === "quente").length ?? 0,\n    providers: snapshot?.providers ?? [],\n  };\n}\n'''
if text.count(old) != 1:
    raise SystemExit('getter marker mismatch')
text = text.replace(old, new, 1)
server.write_text(text)

route = Path('src/routes/api/public/jobs/prospect-radar.tsx')
route.write_text('''import { createFileRoute } from "@tanstack/react-router";\nimport {\n  ensureProspectRadarLoop,\n  getProspectRadarPublicStatus,\n  runScheduledProspectRadar,\n} from "@/lib/prospect-radar.server";\n\n// A rota é carregada pelo servidor no boot. O scheduler usa somente memória do processo\n// e não cria tabela, migration ou escrita no Supabase.\nensureProspectRadarLoop();\n\nfunction authorized(request: Request) {\n  const expected =\n    process.env["CRM_AUTOMATION_JOB_SECRET"]?.trim() ||\n    process.env["PROPERTY_FEED_SYNC_SECRET"]?.trim() ||\n    "";\n  const received = request.headers.get("x-mercadoimobi-job-key")?.trim() || "";\n  return Boolean(expected && received && expected === received);\n}\n\nasync function handlePost(request: Request) {\n  if (!authorized(request)) {\n    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });\n  }\n  const snapshot = await runScheduledProspectRadar();\n  return Response.json({\n    ok: true,\n    searchedAt: snapshot.searchedAt,\n    nextRunAt: snapshot.nextRunAt,\n    leads: snapshot.result.leads.length,\n    hot: snapshot.result.leads.filter((lead) => lead.intentStage === "quente").length,\n    providers: snapshot.providers,\n  });\n}\n\nfunction handleGet() {\n  // Status público contém apenas saúde e contagens agregadas; nenhum perfil, contato ou lead.\n  return Response.json({ ok: true, ...getProspectRadarPublicStatus() });\n}\n\nexport const Route = createFileRoute("/api/public/jobs/prospect-radar")({\n  server: {\n    handlers: {\n      GET: () => handleGet(),\n      POST: ({ request }) => handlePost(request),\n    },\n  },\n});\n''')

functions = Path('src/lib/prospect-leads.functions.ts')
text = functions.read_text()
old = '''    const { getScheduledProspectRadarSnapshot } = await import("@/lib/prospect-radar.server");\n    return getScheduledProspectRadarSnapshot();'''
new = '''    const { ensureProspectRadarLoop, getScheduledProspectRadarSnapshot } = await import(\n      "@/lib/prospect-radar.server"\n    );\n    ensureProspectRadarLoop();\n    return getScheduledProspectRadarSnapshot();'''
if text.count(old) != 1:
    raise SystemExit('snapshot handler marker mismatch')
functions.write_text(text.replace(old, new, 1))

hourly = Path('.github/workflows/hourly-prospect-radar.yml')
if hourly.exists():
    hourly.unlink()
