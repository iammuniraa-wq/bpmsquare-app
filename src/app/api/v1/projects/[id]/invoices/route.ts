import { authorizeApi, jsonOk, corsHeaders, RW_METHODS } from "../../../_auth";
import { createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import {
  projectBillingPreview, createProjectInvoice, projectBilledPeriods, publicPreview, validatePeriod,
  type BillingGranularity,
} from "@/lib/wfm/billingServer";

const GRANULARITIES: BillingGranularity[] = ["project", "sub_project"];

async function gate(req: Request, write: boolean) {
  const auth = await authorizeApi(req, "projects", write);
  if ("error" in auth) return auth;
  const admin = createAdminSupabase();
  const [projectsOn, invoicesOn] = await Promise.all([
    tenantHasFeature(admin, auth.tenantId, "wfm_projects"),
    tenantHasFeature(admin, auth.tenantId, "invoices"),
  ]);
  if (!projectsOn || !invoicesOn) return { error: Response.json({ error: "Not found" }, { status: 404 }) };
  return { tenantId: auth.tenantId, admin };
}

// GET /api/v1/projects/:id/invoices — every invoice raised from this
// project's hours (its own, its sub-projects', or a parent's that covered
// it), newest first. Amounts are what was billed; the invoice itself is at
// /api/v1/invoices/:id.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req, false);
  if ("error" in g) return g.error;
  const { tenantId, admin } = g;
  const { id } = await params;

  const { data: exists } = await admin.from("wfm_projects").select("id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });

  const billed = await projectBilledPeriods(admin, tenantId, id);
  if ("pending_migration" in billed) return jsonOk({ data: [], pending_migration: true });
  return jsonOk({
    data: billed.map((b) => ({ ...b, _links: { invoice: `/api/v1/invoices/${b.invoice_id}`, project: `/api/v1/projects/${b.project_id}` } })),
    _links: { self: `/api/v1/projects/${id}/invoices`, project: `/api/v1/projects/${id}` },
  });
}

// POST /api/v1/projects/:id/invoices — raise a draft invoice for a period,
// or with dry_run:true just see what it would contain (same shape, nothing
// written). Body: { from, to, granularity?: "project"|"sub_project",
// top_up?: boolean, dry_run?: boolean }. Needs write scope on projects.
// Cost and margin never appear here: they are internal to the tenant.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(req, true);
  if ("error" in g) return g.error;
  const { tenantId, admin } = g;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  const bad = validatePeriod(body.from, body.to);
  if (bad) return Response.json({ error: bad }, { status: 400 });
  const gran = (typeof body.granularity === "string" ? body.granularity : "project") as BillingGranularity;
  if (!GRANULARITIES.includes(gran)) return Response.json({ error: "granularity must be project or sub_project" }, { status: 400 });

  if (body.dry_run === true) {
    const preview = await projectBillingPreview(admin, tenantId, id, body.from as string, body.to as string, gran);
    if ("error" in preview) return Response.json({ error: preview.error }, { status: preview.status });
    return jsonOk({ data: publicPreview(preview), _links: { self: `/api/v1/projects/${id}/invoices` } });
  }

  const result = await createProjectInvoice(admin, tenantId, {
    projectId: id, from: body.from as string, to: body.to as string, granularity: gran,
    topUp: body.top_up === true, actorId: null, actorEmail: "api",
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  return new Response(
    JSON.stringify({ data: { ...result, status: "draft" }, _links: { invoice: `/api/v1/invoices/${result.id}`, project: `/api/v1/projects/${id}` } }),
    { status: 201, headers: corsHeaders(RW_METHODS) }
  );
}

export async function OPTIONS() {
  return new Response(null, { headers: corsHeaders(RW_METHODS) });
}
