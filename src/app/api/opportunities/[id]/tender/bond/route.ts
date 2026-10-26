import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { BOND_STATUS_LABEL, BOND_STEPS, type BondStep } from "@/lib/tender/bond";
import { openTenderDealRequest } from "@/lib/tender/dealAccess";
import { isMissingSchema, loadTender } from "@/lib/tender/server";

// POST /api/opportunities/[id]/tender/bond  { action: "release" } | { action: "set_status", status: "requested" | "issued" | "submitted" }
// release: the issuer has handed the bid guarantee back. Who released it and when come from the session and the server clock. A
//   released guarantee stops the expiry warning and the reminder lines that mention it. Releasing twice changes nothing.
// set_status: a person (edit access to the Pipeline) moves the guarantee through Requested, Issued and Submitted. A released guarantee
//   stays released. Before migration 0228 every row is the legacy "held" (which reads as Issued), so Issued changes nothing and the
//   other two answer that a database update is needed (the old check constraint refuses them).

const PENDING_STATES = "The guarantee states Requested and Submitted need a database update (migration 0228). Ask your administrator to apply it.";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
    if (!(await tenantHasFeature(supabase, tenantId, "gcc_tender"))) throw Object.assign(new Error("Not found"), { status: 404 });
    if (!(await tenantHasFeature(supabase, tenantId, "pipeline"))) throw Object.assign(new Error("Pipeline isn't enabled for your workspace"), { status: 403 });
  } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  if (body.action !== "release" && body.action !== "set_status") return NextResponse.json({ error: "action must be release or set_status" }, { status: 400 });

  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  const before = opp ? await loadTender(admin, tenantId, id) : null;
  if (!opp || !before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const label = `${opp.ref ?? ""} ${opp.title}`.trim();

  if (body.action === "set_status") {
    const gate = await openTenderDealRequest(id, true);
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const status = body.status as BondStep;
    if (!(BOND_STEPS as readonly unknown[]).includes(status)) return NextResponse.json({ error: "status must be requested, issued or submitted" }, { status: 400 });
    if (before.bond_status === "released") return NextResponse.json({ error: "A released guarantee stays released" }, { status: 409 });
    const shown = before.bond_status === "held" ? "issued" : before.bond_status;
    if (shown === status) return NextResponse.json(before);

    const now = new Date().toISOString();
    const { data, error } = await admin.from("opportunity_tenders").update({ bond_status: status, updated_at: now })
      .eq("opportunity_id", id).eq("tenant_id", tenantId).neq("bond_status", "released").select("opportunity_id");
    if (error) {
      if (error.code === "23514" || isMissingSchema(error)) return NextResponse.json({ error: PENDING_STATES }, { status: 503 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if ((data ?? []).length > 0) {
      const user = await getAuthUser();
      await logChange(supabase, {
        tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: label, action: "update", actorId: user?.id, actorEmail: user?.email,
        changes: [{ field: "bond_status", from: BOND_STATUS_LABEL[before.bond_status], to: BOND_STATUS_LABEL[status] }],
      });
    }
    return NextResponse.json(await loadTender(admin, tenantId, id));
  }

  if (before.bid_bond_amount == null && !before.bid_bond_expiry) return NextResponse.json({ error: "No bid guarantee is recorded on this tender" }, { status: 409 });
  if (before.bond_status === "released") return NextResponse.json(before);

  const now = new Date().toISOString();
  const { data, error } = await admin.from("opportunity_tenders")
    .update({ bond_status: "released", bond_released_at: now, bond_released_by: userId, updated_at: now })
    .eq("opportunity_id", id).eq("tenant_id", tenantId).neq("bond_status", "released").select("opportunity_id");
  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ error: "Releasing a guarantee needs a database update (migration 0221)" }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if ((data ?? []).length > 0) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: label,
      action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: [{ field: "bond_status", from: before.bond_status, to: "released" }],
    });
  }
  return NextResponse.json(await loadTender(admin, tenantId, id));
}
