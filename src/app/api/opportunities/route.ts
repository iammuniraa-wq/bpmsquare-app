import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { getTenant, tenantHasFeature } from "@/lib/tenant";
import { insertWithMasterRef } from "@/lib/masterRef";
import { diffForLog, logChange } from "@/lib/changeLog";
import { opportunityStages, initialStage, stageDef, probabilityFor, OPPORTUNITY_SOURCES } from "@/lib/sales/opportunity";
import { listOpportunities } from "@/lib/sales/opportunityServer";

// Opportunities (deals) -- Sales Engine Piece B (docs/
// sales-engine-architecture.md §4.3). GET lists with filters; POST creates
// with the initial stage. Every foreign id in the body is verified against
// the tenant before use (MULTI_TENANT_GUARDRAILS.md).

async function guard() {
  const ctx = await requireTenantUser();
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "pipeline"))) {
    throw Object.assign(new Error("Pipeline isn't enabled for your workspace"), { status: 403 });
  }
  return ctx;
}

export async function GET(request: NextRequest) {
  let tenantId;
  try { ({ tenantId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const sp = request.nextUrl.searchParams;
  const rows = await listOpportunities(createAdminSupabase(), tenantId, {
    stage: sp.get("stage"), owner_id: sp.get("owner_id"), account_id: sp.get("account_id"), outcome: sp.get("outcome"),
  });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  let supabase, tenantId, userId;
  try { ({ supabase, tenantId, userId } = await guard()); } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const body = await request.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  if (!body.account_id) return NextResponse.json({ error: "account_id is required" }, { status: 400 });
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });

  const admin = createAdminSupabase();
  const { data: account } = await admin.from("accounts").select("id, name").eq("id", body.account_id).eq("tenant_id", tenantId).maybeSingle();
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (body.contact_id) {
    const { data: contact } = await admin.from("contacts").select("id").eq("id", body.contact_id).eq("tenant_id", tenantId).maybeSingle();
    if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });
  }
  if (body.lead_id) {
    const { data: lead } = await admin.from("leads").select("id").eq("id", body.lead_id).eq("tenant_id", tenantId).maybeSingle();
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const tenant = await getTenant();
  const stages = opportunityStages(tenant?.config);
  const stage = body.stage && stageDef(stages, String(body.stage)) && !stageDef(stages, String(body.stage))?.is_closed ? String(body.stage) : initialStage(stages).value;
  const expectedClose = typeof body.expected_close === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expected_close) ? body.expected_close : null;
  const source = (OPPORTUNITY_SOURCES as readonly string[]).includes(body.source) ? body.source : (body.lead_id ? "lead" : "direct");

  const record = {
    tenant_id: tenantId,
    account_id: account.id,
    contact_id: body.contact_id || null,
    lead_id: body.lead_id || null,
    source,
    source_campaign_id: null,
    title,
    description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
    stage,
    outcome: "open",
    expected_close: expectedClose,
    amount: 0,
    probability: probabilityFor(stages, stage, null),
    owner_id: typeof body.owner_id === "string" && body.owner_id ? body.owner_id : userId,
    team: [],
    competitor: typeof body.competitor === "string" && body.competitor.trim() ? body.competitor.trim() : null,
    created_by: userId,
  };
  const { data, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(admin, "opportunities", tenantId, record, "id, ref");
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunities", objectId: data.id, objectLabel: `${data.ref ?? ""} ${title}`.trim(),
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("opportunities", {}, { title, account: account.name, stage, expected_close: expectedClose }),
  });
  return NextResponse.json(data, { status: 201 });
}
