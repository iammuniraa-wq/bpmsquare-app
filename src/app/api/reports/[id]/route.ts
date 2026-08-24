import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter } from "@/lib/permissions";
import { tenantHasFeature } from "@/lib/tenant";
import { LIST_SOURCES } from "@/lib/api/listSources";
import { parseListQuery, applyListQuery } from "@/lib/api/query";

type Ctx = { params: Promise<{ id: string }> };

async function auth() {
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  // Same module gate as POST /api/reports/ask and GET/POST /api/reports --
  // a tenant without ai_reports can't reach a saved report by id either.
  if (!(await tenantHasFeature(supabase, tenantId, "ai_reports"))) {
    throw { status: 404, message: "Not found" };
  }
  return { tenantId, userId, perms };
}

// GET -- re-run a saved report's compiled query against LIVE data. Never
// replays a stored data snapshot, and never re-calls the model: the row is
// only ever a recipe (docs/ai-report-builder-architecture.md §3.3). Re-checks
// the CALLER's own current permissions on the object, every time (§4.10) --
// a report saved when the viewer had access, opened after that access was
// revoked, 403s exactly like a fresh /ask call would.
export async function GET(_req: Request, { params }: Ctx) {
  let tenantId: string, perms: Awaited<ReturnType<typeof resolvePermissions>>;
  try {
    ({ tenantId, perms } = await auth());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  if (!canViewWorkcenter(perms, "reports")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const admin = createAdminSupabase();
  const { data: report } = await admin
    .from("ai_reports")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId)
    .maybeSingle();
  if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  const src = LIST_SOURCES[report.object as string];
  if (!src || !canViewWorkcenter(perms, src.relatedWorkcenter)) {
    return NextResponse.json({ error: "You no longer have access to this report's data." }, { status: 403 });
  }

  const sp = new URLSearchParams(report.compiled_query as string);
  const parsed = parseListQuery(sp, src.fields);
  if (!parsed.ok) {
    return NextResponse.json({ error: "This saved report's query is no longer valid: " + parsed.errors.map((e) => e.message).join("; ") }, { status: 500 });
  }

  const rows = await src.load(tenantId);
  const result = applyListQuery(rows, parsed.query);

  return NextResponse.json({
    id: report.id,
    question: report.question,
    object: report.object,
    object_label: src.label,
    chart_type: report.chart_type,
    title: report.title,
    interpretation: report.interpretation,
    pinned_to_dashboard: report.pinned_to_dashboard,
    data: result.data,
    groups: result.meta.groups ?? null,
    aggregates: result.meta.aggregates ?? null,
    total: result.meta.total,
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  let tenantId: string, perms: Awaited<ReturnType<typeof resolvePermissions>>;
  try {
    ({ tenantId, perms } = await auth());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  if (!canEditWorkcenter(perms, "reports")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const admin = createAdminSupabase();
  const { error } = await admin.from("ai_reports").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
