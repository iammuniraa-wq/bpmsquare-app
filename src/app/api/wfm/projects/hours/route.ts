import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { workSessions } from "@/lib/wfm/hours";
import { rollUpProjectHours, projectHeadcount, UNASSIGNED, type SessionsForEmployee } from "@/lib/wfm/projectHours";
import { rollUp, depthOf } from "@/lib/wfm/projectTree";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

// GET /api/wfm/projects/hours?from=&to=[&project_id=] — worked hours rolled
// up per project for a date window. The point of the whole capability: where
// did the time go, and how much of it nobody attributed.
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

  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, tenantId);

  // A supervisor sees their own subtree only, same boundary as every other
  // WFM read (/api/wfm/presence, live board). Project totals are not a
  // loophole around it.
  const scope = await resolveWfmScope(ctx);

  let eventsQuery = admin
    .from("wfm_presence_events")
    .select("employee_id, kind, ts, project_id")
    .eq("tenant_id", tenantId)
    .is("superseded_by", null)
    // Padded a day either side so a night shift's punches around midnight are
    // included; the session split itself handles the attribution.
    .gte("ts", `${from}T00:00:00Z`)
    .lt("ts", new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString())
    .order("ts", { ascending: true });

  if (!scope.unrestricted) {
    const ids = scope.employeeIds ?? [];
    if (ids.length === 0) return NextResponse.json({ rows: [], projects: {} });
    eventsQuery = eventsQuery.in("employee_id", ids);
  }

  const { data: events, error } = await eventsQuery;
  if (error) {
    // 42P01/42703 = 0104 not applied yet (§3b: degrade, never crash).
    if (error.code === "42P01" || error.code === "42703") {
      return NextResponse.json({ rows: [], projects: {}, pending_migration: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byEmployee = new Map<string, { kind: string; ts: string; project_id: string | null }[]>();
  for (const e of events ?? []) {
    const id = e.employee_id as string;
    byEmployee.set(id, [...(byEmployee.get(id) ?? []), e as never]);
  }

  const endRef = new Date();
  const input: SessionsForEmployee[] = [...byEmployee].map(([employee_id, evs]) => ({
    employee_id,
    sessions: workSessions(evs as never, endRef),
  }));

  let rows = rollUpProjectHours(input, config.deduct_breaks);
  const heads = projectHeadcount(input);

  const projectId = request.nextUrl.searchParams.get("project_id");

  // The WHOLE tree is fetched, not just the projects with hours: an hour
  // booked to a WBS has to appear in its parent's total, and the parent may
  // have no punches of its own.
  const { data: allProjects } = await admin
    .from("wfm_projects")
    .select("id, name, ref, status, parent_id")
    .eq("tenant_id", tenantId);

  const tree = (allProjects ?? []).map((p) => ({
    id: p.id as string,
    parent_id: (p.parent_id as string | null) ?? null,
  }));
  const byId = new Map(tree.map((t) => [t.id, t]));

  const ownMinutes = new Map<string, number>();
  for (const r of rows) if (r.key !== UNASSIGNED) ownMinutes.set(r.key, r.net_minutes);
  const rolled = rollUp(tree, ownMinutes);

  const names: Record<string, { name: string; ref: string | null; status: string; parent_id: string | null; depth: number }> = {};
  for (const p of allProjects ?? []) {
    const id = p.id as string;
    names[id] = {
      name: p.name as string,
      ref: p.ref as string | null,
      status: p.status as string,
      parent_id: (p.parent_id as string | null) ?? null,
      depth: depthOf(byId, id) ?? 0,
    };
  }

  // own_minutes is what landed directly on a row; total_minutes includes
  // everything beneath it. A flat tenant sees the two agree everywhere.
  const withRollup = rows.map((r) => ({
    ...r,
    employees: heads.get(r.key) ?? 0,
    own_minutes: r.net_minutes,
    total_minutes: r.key === UNASSIGNED ? r.net_minutes : (rolled.get(r.key)?.total ?? r.net_minutes),
  }));

  // A parent with no punches of its own still needs a row once its children
  // have hours -- otherwise a project whose work all sits on its WBS items
  // would be missing from its own report.
  const present = new Set(withRollup.map((r) => r.key));
  for (const [id, v] of rolled) {
    if (present.has(id) || v.total === 0) continue;
    withRollup.push({
      key: id,
      gross_minutes: 0,
      break_minutes: 0,
      net_minutes: 0,
      sessions: 0,
      employees: 0,
      own_minutes: 0,
      total_minutes: v.total,
    });
  }
  withRollup.sort((a, b) => b.total_minutes - a.total_minutes);

  return NextResponse.json({
    from, to,
    deduct_breaks: config.deduct_breaks,
    rows: projectId ? withRollup.filter((r) => r.key === projectId) : withRollup,
    projects: names,
  });
}
