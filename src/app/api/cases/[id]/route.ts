import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { requireTenantUser, createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";

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

    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "cases", objectId: id, objectLabel: snap.ref,
      action: "delete", actorId: user?.id, actorEmail: user?.email,
    });
  }
  revalidateTag("accounts", { expire: 0 });
  revalidateTag("cases", { expire: 0 });
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
  // asset_ids comes straight from the request body -- verify each belongs to
  // this tenant before it's linked (same reasoning as the POST route above).
  if ("asset_ids" in body) {
    const cleanAssetIds: string[] = Array.isArray(body.asset_ids) ? body.asset_ids.filter(Boolean) : [];
    if (cleanAssetIds.length > 0) {
      const { data: verifiedAssets } = await supabase.from("assets").select("id").in("id", cleanAssetIds).eq("tenant_id", tenantId);
      if (!verifiedAssets || verifiedAssets.length !== new Set(cleanAssetIds).size) {
        return NextResponse.json({ error: "One or more assets not found" }, { status: 404 });
      }
    }
    patch.asset_ids = cleanAssetIds;
    patch.asset_id = cleanAssetIds[0] ?? null;
  }

  const { data: before } = await supabase
    .from("service_cases")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { data, error } = await supabase
    .from("service_cases")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const user = await getAuthUser();
  const changes = diffForLog("cases", (before as Record<string, unknown>) ?? {}, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "cases", objectId: id, objectLabel: (data as { ref?: string }).ref ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(data);
}
