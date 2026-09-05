import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { requireWfmSupervisor } from "@/lib/wfm/server";
import { tenantHasFeature } from "@/lib/tenant";
import {
  projectBillingPreview, createProjectInvoice, projectBilledPeriods, validatePeriod,
  type BillingGranularity,
} from "@/lib/wfm/billingServer";

const GRANULARITIES: BillingGranularity[] = ["project", "sub_project"];

// GET /api/wfm/projects/[id]/billing?from&to&granularity — what an invoice
// for that period would contain, plus everything already billed on this
// project's tree. Without from/to, just the billed list. Supervisors can
// look (it is their hours); raising the invoice is admin-only, below.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor({ feature: "wfm_projects" });
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;
  const { id } = await params;
  const admin = createAdminSupabase();

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from && !to) {
    const billed = await projectBilledPeriods(admin, tenantId, id);
    if ("pending_migration" in billed) return NextResponse.json({ billed: [], pending_migration: true });
    return NextResponse.json({ billed });
  }

  const bad = validatePeriod(from, to);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const g = (searchParams.get("granularity") ?? "project") as BillingGranularity;
  if (!GRANULARITIES.includes(g)) return NextResponse.json({ error: "granularity must be project or sub_project" }, { status: 400 });

  const preview = await projectBillingPreview(admin, tenantId, id, from!, to!, g);
  if ("error" in preview) return NextResponse.json({ error: preview.error }, { status: preview.status });
  // Cost and margin are internal: only an admin sees them on the preview.
  if (ctx.role !== "admin") {
    return NextResponse.json({ ...preview, cost: null, margin_pct: null, lines: preview.lines.map((l) => ({ ...l, cost: 0 })) });
  }
  return NextResponse.json(preview);
}

// POST /api/wfm/projects/[id]/billing — raise a draft invoice for a period.
// Admin only, and only where the Invoices module is on: the invoice lands in
// that module's list, so a tenant without it has nowhere to see the draft.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor({ feature: "wfm_projects" });
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (ctx.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { tenantId, userId } = ctx;
  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "invoices"))) {
    return NextResponse.json({ error: "The Invoices module isn't enabled for this workspace." }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const bad = validatePeriod(body.from, body.to);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const g = (typeof body.granularity === "string" ? body.granularity : "project") as BillingGranularity;
  if (!GRANULARITIES.includes(g)) return NextResponse.json({ error: "granularity must be project or sub_project" }, { status: 400 });

  const user = await getAuthUser();
  const result = await createProjectInvoice(admin, tenantId, {
    projectId: id, from: body.from as string, to: body.to as string, granularity: g,
    topUp: body.top_up === true, actorId: userId, actorEmail: user?.email ?? null,
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result, { status: 201 });
}
