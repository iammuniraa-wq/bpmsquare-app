import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { isMissingSchema, loadTender } from "@/lib/tender/server";

// POST /api/opportunities/[id]/tender/bond  { action: "release" }
// The issuer has handed the bid bond back. Who released it and when come from the session and the server clock. A released
// bond stops the expiry warning and the reminder lines that mention the bond. Releasing twice changes nothing.

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
  if (body.action !== "release") return NextResponse.json({ error: "action must be release" }, { status: 400 });

  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  const before = opp ? await loadTender(admin, tenantId, id) : null;
  if (!opp || !before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (before.bid_bond_amount == null && !before.bid_bond_expiry) return NextResponse.json({ error: "No bid bond is recorded on this tender" }, { status: 409 });
  if (before.bond_status === "released") return NextResponse.json(before);

  const now = new Date().toISOString();
  const { data, error } = await admin.from("opportunity_tenders")
    .update({ bond_status: "released", bond_released_at: now, bond_released_by: userId, updated_at: now })
    .eq("opportunity_id", id).eq("tenant_id", tenantId).neq("bond_status", "released").select("opportunity_id");
  if (error) {
    if (isMissingSchema(error)) return NextResponse.json({ error: "Releasing a bond needs a database update (migration 0221)" }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if ((data ?? []).length > 0) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(),
      action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: [{ field: "bond_status", from: "held", to: "released" }],
    });
  }
  return NextResponse.json(await loadTender(admin, tenantId, id));
}
