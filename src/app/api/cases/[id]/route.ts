import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { id } = await params;

  const { data: snap } = await supabase
    .from("service_cases")
    .select("ref, status, equipment_label, account_id, created_at")
    .eq("id", id).eq("tenant_id", tenantId).single();

  const { error } = await supabase.from("service_cases").delete().eq("id", id).eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (snap) {
    const admin = createAdminSupabase();
    const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).single();
    const cfg = (tenant?.config ?? {}) as Record<string, unknown>;
    const log = Array.isArray(cfg.deleted_cases) ? (cfg.deleted_cases as unknown[]) : [];
    log.push({ id, ref: snap.ref, name: snap.equipment_label ?? null, status: snap.status, account_id: snap.account_id, created_at: snap.created_at, deleted_at: new Date().toISOString(), deleted_by: userId });
    await admin.from("tenants").update({ config: { ...cfg, deleted_cases: log } }).eq("id", tenantId);
  }
  return new NextResponse(null, { status: 204 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const body = await request.json();

  const allowed = ["status", "priority", "description", "custom_data", "notes", "assigned_to", "complaint", "symptom", "equipment_label", "asset_ids", "territory", "sales_org"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];

  // Keep the legacy single asset_id in sync with the new asset_ids array (primary = first).
  if ("asset_ids" in body) {
    const cleanAssetIds: string[] = Array.isArray(body.asset_ids) ? body.asset_ids.filter(Boolean) : [];
    patch.asset_ids = cleanAssetIds;
    patch.asset_id = cleanAssetIds[0] ?? null;
  }

  const { data, error } = await supabase
    .from("service_cases")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
