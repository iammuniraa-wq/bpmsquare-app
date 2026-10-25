import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { logChange } from "@/lib/changeLog";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import { tenderSettings } from "@/lib/tender/approval";
import { loadMembership } from "@/lib/tender/approvalServer";

// GET / PUT /api/settings/tender -- who may approve a bid / no-bid proposal, and whether a proposer may approve their own
// (docs/design/gcc-tender-deals.md section 10). Stored in tenants.config.tender. Admin-only in both directions. An approver
// id from the body is checked against tenant_users of THIS workspace before it is stored (guardrails: unverified ids).

const MAX_APPROVERS = 50;

async function guard() {
  const ctx = await requireTenantUser();
  if (ctx.role !== "admin") throw Object.assign(new Error("Forbidden"), { status: 403 });
  if (!(await tenantHasFeature(ctx.supabase, ctx.tenantId, "gcc_tender"))) throw Object.assign(new Error("Not found"), { status: 404 });
  return ctx;
}
const fail = (e: unknown) => {
  const err = e as { status?: number; message: string };
  return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
};

export async function GET() {
  let tenantId;
  try { ({ tenantId } = await guard()); } catch (e) { return fail(e); }
  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  const settings = tenderSettings((data?.config as { tender?: unknown } | null) as Parameters<typeof tenderSettings>[0]);
  const [people, { adminIds }] = await Promise.all([listMembersForPicker(admin, tenantId), loadMembership(admin, tenantId)]);
  return NextResponse.json({
    approvers: settings.approvers,
    allow_self_approval: settings.allowSelfApproval,
    members: people.map((m) => ({ ...m, is_admin: adminIds.includes(m.user_id) })),
  });
}

export async function PUT(request: NextRequest) {
  let supabase, tenantId;
  try { ({ supabase, tenantId } = await guard()); } catch (e) { return fail(e); }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const requested = Array.isArray(body.approvers) ? [...new Set(body.approvers.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
  if (requested.length > MAX_APPROVERS) return NextResponse.json({ error: `Up to ${MAX_APPROVERS} approvers` }, { status: 400 });
  const allowSelf = body.allow_self_approval === true;

  const admin = createAdminSupabase();
  const { memberIds } = await loadMembership(admin, tenantId);
  const members = new Set(memberIds);
  if (requested.some((id) => !members.has(id))) return NextResponse.json({ error: "Every approver must be a member of this workspace" }, { status: 422 });

  const { data: current, error: readErr } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  const config = (current?.config ?? {}) as Record<string, unknown>;
  const before = tenderSettings(config as Parameters<typeof tenderSettings>[0]);
  const merged = { ...config, tender: { approvers: requested, allow_self_approval: allowSelf } };
  const { error } = await admin.from("tenants").update({ config: merged }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "tenants", objectId: tenantId, objectLabel: "Tender approval settings", action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [
      { field: "Bid approvers", from: before.approvers.length ? `${before.approvers.length} chosen` : "Workspace admins", to: requested.length ? `${requested.length} chosen` : "Workspace admins" },
      { field: "Allow self-approval", from: before.allowSelfApproval, to: allowSelf },
    ].filter((c) => c.from !== c.to),
  });
  return NextResponse.json({ ok: true });
}
