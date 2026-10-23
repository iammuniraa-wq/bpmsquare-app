import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { resolvePermissions, canCreateWorkcenter } from "@/lib/permissions";
import { diffForLog, logChange } from "@/lib/changeLog";
import { generateNextWorkOrderRef } from "@/lib/workOrderRef";
import {
  isWorkableCaseStatus,
  normaliseScheduledFor,
  resolveWorkOrderAuth,
  OPEN_WORK_ORDER_STATUSES,
} from "@/lib/workOrderFromCase";

/**
 * POST /api/work-orders -- raise a work order from a service case.
 *
 *   { case_id, scheduled_for?: "YYYY-MM-DD", technician_id?, description?, notes?, confirm_another?: boolean }
 *
 * Account, asset and the authorisation (quote or AMC contract) come from the case, never from the body:
 * the only ids the caller supplies are the case and the technician, and both are verified against the
 * tenant before use. A second open work order for the same case is refused with 409 until the caller
 * confirms (`confirm_another`), which is also what stops a double-click from creating two.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const gate = (await assertObjectFeature(tenantId, "work_orders")) ?? (await assertObjectFeature(tenantId, "cases"));
  if (gate) return gate;

  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  if (!canCreateWorkcenter(perms, "work_orders")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const caseId = typeof body.case_id === "string" ? body.case_id : "";
  if (!caseId) return NextResponse.json({ error: "case_id is required" }, { status: 400 });

  const scheduledFor = normaliseScheduledFor(body.scheduled_for);
  if (!scheduledFor) return NextResponse.json({ error: "scheduled_for is not a valid date" }, { status: 400 });

  const technicianId = typeof body.technician_id === "string" && body.technician_id ? body.technician_id : null;
  const confirmAnother = body.confirm_another === true;

  const { data: sc } = await supabase
    .from("service_cases")
    .select("id, ref, account_id, type, status, asset_id, asset_ids, equipment_label, complaint, quote_id, contract_id")
    .eq("id", caseId).eq("tenant_id", tenantId).maybeSingle();
  if (!sc) return NextResponse.json({ error: "Case not found" }, { status: 404 });

  if (!isWorkableCaseStatus(sc.status as string)) {
    return NextResponse.json({ error: "This case is closed, so no work order can be raised for it." }, { status: 409 });
  }

  const auth = resolveWorkOrderAuth(sc as { type: string; quote_id: string | null; contract_id: string | null });
  if (!auth) {
    return NextResponse.json(
      { error: "Link a quotation or an AMC contract to this case first. A work order needs one to authorise it.", code: "no_authorisation" },
      { status: 422 },
    );
  }

  // The case row already belongs to this tenant, but the ids stored on it are only as trustworthy as
  // whoever wrote them: verify each one against the tenant again before weaving it into a new row.
  const authTable = auth.kind === "quote" ? "quotes" : "contracts";
  const { data: authRow } = await supabase
    .from(authTable).select("id").eq("id", auth.id).eq("tenant_id", tenantId).maybeSingle();
  if (!authRow) {
    return NextResponse.json({ error: `The case's ${auth.kind} was not found.`, code: "no_authorisation" }, { status: 422 });
  }

  const { data: acct } = await supabase
    .from("accounts").select("id").eq("id", sc.account_id as string).eq("tenant_id", tenantId).maybeSingle();
  if (!acct) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const caseAssetIds = (sc.asset_ids as string[] | null) ?? [];
  const candidateAssetId = (sc.asset_id as string | null) ?? caseAssetIds[0] ?? null;
  let assetId: string | null = null;
  if (candidateAssetId) {
    const { data: asset } = await supabase
      .from("assets").select("id").eq("id", candidateAssetId).eq("tenant_id", tenantId).maybeSingle();
    assetId = asset ? (asset.id as string) : null;
  }

  if (technicianId) {
    const { data: tech } = await supabase
      .from("technicians").select("id").eq("id", technicianId).eq("tenant_id", tenantId).maybeSingle();
    if (!tech) return NextResponse.json({ error: "Technician not found" }, { status: 404 });
  }

  const { data: open } = await supabase
    .from("work_orders")
    .select("id, ref, status")
    .eq("tenant_id", tenantId).eq("case_id", caseId)
    .in("status", [...OPEN_WORK_ORDER_STATUSES]);
  if ((open ?? []).length > 0 && !confirmAnother) {
    return NextResponse.json(
      { error: "This case already has an open work order.", code: "open_work_order_exists", existing: open },
      { status: 409 },
    );
  }

  const description = typeof body.description === "string" && body.description.trim()
    ? body.description.trim().slice(0, 2000)
    : (sc.complaint as string | null)?.slice(0, 2000) ?? null;
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 2000) : null;

  const ref = await generateNextWorkOrderRef(supabase, tenantId);
  const record = {
    tenant_id: tenantId,
    account_id: sc.account_id,
    ref,
    case_id: caseId,
    asset_id: assetId,
    technician_id: technicianId,
    auth_kind: auth.kind,
    auth_id: auth.id,
    status: "scheduled",
    scheduled_for: scheduledFor,
    description,
    notes,
  };
  const { data: wo, error } = await supabase.from("work_orders").insert(record).select("id, ref").single();
  if (error || !wo) return NextResponse.json({ error: error?.message ?? "Could not create work order" }, { status: 500 });

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "work_orders", objectId: wo.id as string, objectLabel: wo.ref as string,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: diffForLog("work_orders", {}, {
      case_id: caseId, asset_id: assetId, technician_id: technicianId,
      auth_kind: auth.kind, auth_id: auth.id, scheduled_for: scheduledFor,
    }),
  });
  // The case's timeline: the work order shows up in its change history.
  await logChange(supabase, {
    tenantId, objectType: "cases", objectId: caseId, objectLabel: sc.ref as string,
    action: "update", actorId: user?.id, actorEmail: user?.email,
    changes: [{ field: "work_order", from: null, to: wo.ref }],
  });

  return NextResponse.json(wo, { status: 201 });
}
