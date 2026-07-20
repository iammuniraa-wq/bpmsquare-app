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

  // Snapshot quote before deletion for audit log
  const { data: snap } = await supabase
    .from("quotes")
    .select("ref, name, status, total, account_id, created_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  const { error } = await supabase
    .from("quotes")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Append deletion record to tenants.config.deleted_quotes
  if (snap) {
    const admin = createAdminSupabase();
    const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).single();
    const cfg = (tenant?.config ?? {}) as Record<string, unknown>;
    const log = Array.isArray(cfg.deleted_quotes) ? (cfg.deleted_quotes as unknown[]) : [];
    log.push({
      id,
      ref:        snap.ref,
      name:       snap.name ?? null,
      status:     snap.status,
      total:      snap.total,
      account_id: snap.account_id,
      created_at: snap.created_at,
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
    });
    await admin.from("tenants").update({ config: { ...cfg, deleted_quotes: log } }).eq("id", tenantId);
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

  // discount_type/discount_pct/discount_fixed/gst_rate are deliberately not
  // patchable here -- they feed the stored `total`, which only the full edit
  // flow (/quotations/[id]/edit) recalculates. Allowing them here would let
  // an inline edit leave `total` stale.
  const allowed = [
    "status", "custom_data",
    "name", "type", "valid_until", "ref_no", "pr_no",
    "po_number", "po_amount", "territory", "sales_org",
    "scope_of_work", "notes", "terms",
  ];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];

  const { data, error } = await createAdminSupabase()
    .from("quotes")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) { console.error("[quotes PATCH] update failed", error); return NextResponse.json({ error: error.message }, { status: 500 }); }
  return NextResponse.json(data);
}
