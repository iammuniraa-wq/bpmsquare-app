import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";

// GET /api/wfm/approvals — "My Approvals": everything pending THIS
// supervisor's decision, in one payload for the portal tile. Counts only,
// plus a few newest items per queue for a glance; acting on them happens on
// the existing pages (corrections / leave / OT), which carry the full
// context and the same scope rules.
export async function GET() {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const admin = createAdminSupabase();

  // Same subtree scoping as the queues themselves — a site supervisor counts
  // their own people, not the whole tenant.
  const scope = await resolveWfmScope(ctx);
  const scoped = <T extends { in: (col: string, vals: string[]) => T }>(q: T): T =>
    scope.unrestricted ? q : q.in("employee_id", scope.employeeIds ?? []);

  const PREVIEW = 3;
  const [corr, leave, ot] = await Promise.all([
    scoped(
      admin
        .from("wfm_correction_requests")
        .select("id, target_date, created_at, employees(first_name, last_name)", { count: "exact" })
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(PREVIEW)
    ),
    scoped(
      admin
        .from("wfm_leave_requests")
        .select("id, date_from, date_to, created_at, employees(first_name, last_name)", { count: "exact" })
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(PREVIEW)
    ),
    scoped(
      admin
        .from("wfm_ot_sessions")
        .select("id, ot_date, minutes, employees(first_name, last_name)", { count: "exact" })
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "pending")
        .order("started_at", { ascending: false })
        .limit(PREVIEW)
    ),
  ]);

  const name = (e: unknown): string => {
    const emp = (Array.isArray(e) ? e[0] : e) as { first_name?: string; last_name?: string } | null;
    return [emp?.first_name, emp?.last_name].filter(Boolean).join(" ") || "—";
  };

  return NextResponse.json({
    corrections: {
      count: corr.count ?? 0,
      items: (corr.data ?? []).map((r) => ({ id: r.id, who: name(r.employees), when: r.target_date })),
    },
    leave: {
      count: leave.count ?? 0,
      items: (leave.data ?? []).map((r) => ({ id: r.id, who: name(r.employees), when: `${r.date_from} → ${r.date_to}` })),
    },
    overtime: {
      count: ot.count ?? 0,
      items: (ot.data ?? []).map((r) => ({ id: r.id, who: name(r.employees), when: `${r.ot_date} · ${Math.round((r.minutes as number) / 60 * 10) / 10}h` })),
    },
  });
}
