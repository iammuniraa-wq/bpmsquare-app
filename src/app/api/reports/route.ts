import { NextResponse } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { resolvePermissions, canViewWorkcenter, canEditWorkcenter } from "@/lib/permissions";
import { tenantHasFeature } from "@/lib/tenant";
import { LIST_SOURCES } from "@/lib/api/listSources";

// Saved "talk to data" reports (docs/ai-report-builder-architecture.md §3.3).
// The row stores the RECIPE (question, routed object, compiled query spec,
// chart type) -- never a data snapshot. GET /api/reports/[id] re-runs it
// live and re-checks the VIEWER's own current permissions every time, not
// the creator's at save time (§4.10) -- this list route does the same:
// a report against an object the caller can no longer view is left out.

async function auth() {
  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  // ai_reports is a separately sold module (docs/ai-vision.md) -- the "reports"
  // workcenter also covers the plain analytics dashboard, so a tenant without
  // ai_reports must not be able to list, save, open or delete a saved AI
  // report just because they can view Analytics. Mirrors the gate already on
  // POST /api/reports/ask (the /ask route itself doesn't touch this table).
  if (!(await tenantHasFeature(supabase, tenantId, "ai_reports"))) {
    throw { status: 404, message: "Not found" };
  }
  return { tenantId, userId, perms };
}

export async function GET() {
  let tenantId: string, perms: Awaited<ReturnType<typeof resolvePermissions>>;
  try {
    ({ tenantId, perms } = await auth());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  if (!canViewWorkcenter(perms, "reports")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("ai_reports")
    .select("id, question, object, chart_type, title, interpretation, pinned_to_dashboard, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) {
    if (error.code === "42P01") return NextResponse.json({ reports: [] }); // migration not yet applied -- degrade cleanly
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const reports = (data ?? []).filter((r) => {
    const src = LIST_SOURCES[r.object as string];
    return src && canViewWorkcenter(perms, src.relatedWorkcenter);
  });
  return NextResponse.json({ reports });
}

export async function POST(req: Request) {
  let tenantId: string, userId: string, perms: Awaited<ReturnType<typeof resolvePermissions>>;
  try {
    ({ tenantId, userId, perms } = await auth());
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message ?? "Unauthorized" }, { status: err.status ?? 401 });
  }
  if (!canEditWorkcenter(perms, "reports")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });

  const object = typeof body.object === "string" ? body.object : "";
  const src = LIST_SOURCES[object];
  if (!src || !canViewWorkcenter(perms, src.relatedWorkcenter)) {
    return NextResponse.json({ error: "Unknown or inaccessible object" }, { status: 422 });
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const chartType = typeof body.chart_type === "string" ? body.chart_type : "";
  const compiledQuery = typeof body.compiled_query === "string" ? body.compiled_query : "";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : question || src.label;
  const interpretation = typeof body.interpretation === "string" ? body.interpretation : "";
  if (!question || !["stat", "bar", "line", "table"].includes(chartType)) {
    return NextResponse.json({ error: "Missing question or invalid chart_type" }, { status: 422 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("ai_reports")
    .insert({
      tenant_id: tenantId, created_by: userId, question, object,
      chart_type: chartType, compiled_query: compiledQuery, title, interpretation,
      pinned_to_dashboard: Boolean(body.pinned_to_dashboard),
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}
