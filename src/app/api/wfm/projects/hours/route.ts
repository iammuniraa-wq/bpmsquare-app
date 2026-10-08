import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { projectHoursReport } from "@/lib/wfm/projectHoursServer";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

// GET /api/wfm/projects/hours?from=&to=[&project_id=] — worked hours rolled
// up per project for a date window. The point of the whole capability: where
// did the time go, and how much of it nobody attributed. The arithmetic lives
// in projectHoursReport, shared with the v1 API.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor({ feature: "wfm_projects" });
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;

  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  if (!from || !DATE_RE.test(from) || !to || !DATE_RE.test(to)) {
    return NextResponse.json({ error: "from and to (YYYY-MM-DD) are required" }, { status: 400 });
  }
  if (to < from) return NextResponse.json({ error: "to must be on or after from" }, { status: 400 });
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_DAYS) {
    return NextResponse.json({ error: `Pick a window of ${MAX_DAYS} days or fewer` }, { status: 400 });
  }

  // A supervisor sees their own subtree only, same boundary as every other
  // WFM read (/api/wfm/presence, live board). Project totals are not a
  // loophole around it.
  const scope = await resolveWfmScope(ctx);
  const employeeIds = scope.unrestricted ? null : (scope.employeeIds ?? []);

  try {
    const report = await projectHoursReport(createAdminSupabase(), tenantId, from, to, {
      employeeIds,
      projectId: request.nextUrl.searchParams.get("project_id"),
    });
    return NextResponse.json(report);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
