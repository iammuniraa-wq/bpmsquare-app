import { NextResponse, type NextRequest } from "next/server";
import { openCrew } from "@/lib/crew/server/access";
import { canSeeRuns } from "@/lib/crew/core/visibility";
import { loadRun, loadSettings, loadSteps } from "@/lib/crew/server/store";

// GET /api/crew/runs/[id] -> the trace of one run: what it looked at, concluded, proposed and could not check (design section 3.6).
// Same people who may see the agent's runs. The stored tool results are already minimised (tender: user ids only, no names or prices).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const door = await openCrew();
  if (!door.ok) return door.res;
  const { ctx } = door;
  const run = await loadRun(ctx.admin, ctx.tenantId, id);
  if (!run || !ctx.agents.some((a) => a.key === run.agent_key)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const settings = await loadSettings(ctx.admin, ctx.tenantId);
  if (!canSeeRuns(ctx, settings.get(run.agent_key).config.visibility)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ run, steps: await loadSteps(ctx.admin, ctx.tenantId, id) });
}
