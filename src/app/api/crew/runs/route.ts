import { NextResponse, type NextRequest } from "next/server";
import { canSeeRun, canSeeRuns } from "@/lib/crew/core/visibility";
import { openCrew, viewerWithScope } from "@/lib/crew/server/access";
import { isAgentKey } from "@/lib/crew/registry";
import { agentModule } from "@/lib/crew/definitions";
import { listRuns, loadSettings, recentRunCount } from "@/lib/crew/server/store";
import { planTenant } from "@/lib/crew/server/planner";

// GET  /api/crew/runs?agent=tender_watch  -> the Runs tab (newest first); admins always, others only where the agent has been widened to them.
// POST /api/crew/runs { agent }           -> "Run now": enqueues one manual run (rate: 1 per agent per hour per workspace). Workspace admins only
//                                           while an agent is in its shadow period. The agent's own plan() decides what is worth a model's time.

export async function GET(request: NextRequest) {
  const agent = request.nextUrl.searchParams.get("agent");
  const door = await openCrew(agent);
  if (!door.ok) return door.res;
  const { ctx } = door;
  const settings = await loadSettings(ctx.admin, ctx.tenantId);
  if (!canSeeRuns(ctx, agent && isAgentKey(agent) ? settings.get(agent).config.visibility : undefined)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { rows, pending } = await listRuns(ctx.admin, ctx.tenantId, agent && isAgentKey(agent) ? agent : null);
  const viewer = await viewerWithScope(ctx);
  return NextResponse.json({ pending, runs: rows.filter((r) => canSeeRun(viewer, r, settings.get(r.agent_key).config.visibility)) });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { agent?: unknown } | null;
  const agent = typeof body?.agent === "string" ? body.agent : null;
  const door = await openCrew(agent, { adminOnly: true });
  if (!door.ok) return door.res;
  const { ctx, entry } = door;
  if (!entry || !agentModule(entry.key) || entry.engine !== "ready") return NextResponse.json({ error: "This agent has no engine yet." }, { status: 409 });
  const settings = await loadSettings(ctx.admin, ctx.tenantId);
  if (settings.pending) return NextResponse.json({ error: "AI automation needs a database update (migration 0245)." }, { status: 503 });
  if (!settings.get(entry.key).enabled) return NextResponse.json({ error: "Switch the agent on first." }, { status: 409 });
  if (settings.get(entry.key).paused || settings.get("_workspace").paused) return NextResponse.json({ error: "Agents are paused. Resume them first." }, { status: 409 });

  const now = new Date();
  const recent = await recentRunCount(ctx.admin, ctx.tenantId, entry.key, "manual", new Date(now.getTime() - 3_600_000).toISOString());
  if (recent >= 1) return NextResponse.json({ error: "A manual run was started in the last hour. Try again later." }, { status: 429 });

  // The agent's plan() builds the run (candidates, snapshot); a manual run is enqueued like any other and executed by the work cron.
  const res = await planTenant(ctx.admin, ctx.tenant, now, "manual", null, entry.key);
  if (res.pending) return NextResponse.json({ error: "AI automation needs a database update (migration 0245)." }, { status: 503 });
  return NextResponse.json({ ok: true, queued: res.enqueued, quiet: res.quiet, notes: res.notes }, { status: 202 });
}
