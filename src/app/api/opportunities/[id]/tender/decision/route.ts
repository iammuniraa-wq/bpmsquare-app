import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { diffForLog, logChange } from "@/lib/changeLog";
import { loadOpportunity } from "@/lib/sales/opportunityServer";
import { parseDecision } from "@/lib/tender/rules";
import { loadTender } from "@/lib/tender/server";

// POST /api/opportunities/[id]/tender/decision  { decision: "go" | "no_go", reason? }
// The recorded bid / no-bid decision. A no-go needs a reason. WHO decided and WHEN come from the session and the server
// clock, never from the body: a request cannot name another person as the decider or back-date the decision.

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
  const parsed = parseDecision(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = createAdminSupabase();
  const opp = await loadOpportunity(admin, tenantId, id);
  const before = opp ? await loadTender(admin, tenantId, id) : null;
  if (!opp || !before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (before.decision === parsed.decision && (before.decision_reason ?? null) === parsed.reason) {
    return NextResponse.json(before);
  }

  const now = new Date().toISOString();
  const patch = { decision: parsed.decision, decision_reason: parsed.reason, decided_by: userId, decided_at: now, updated_at: now };
  const { error } = await admin.from("opportunity_tenders").update(patch).eq("opportunity_id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "opportunity_tenders", objectId: id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(),
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("opportunity_tenders", before as unknown as Record<string, unknown>, { decision: parsed.decision, decision_reason: parsed.reason }),
  });
  return NextResponse.json(await loadTender(admin, tenantId, id));
}
