import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
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

  // qty_on_hand is intentionally never patchable here -- it only changes via
  // /adjust or /purchase-orders/[id]/receive, so every change is ledgered.
  const allowed = ["sku", "name", "description", "category", "uom", "supplier_id", "reorder_level", "unit_cost", "notes", "status", "custom_data"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];

  const { data: before } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { data, error } = await supabase
    .from("inventory_items")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A SKU with that value already exists" }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const user = await getAuthUser();
  const changes = diffForLog("inventory", (before as Record<string, unknown>) ?? {}, patch);
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "inventory", objectId: id, objectLabel: (data as { name?: string }).name ?? null,
      action: "update", actorId: user?.id, actorEmail: user?.email, changes,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { id } = await params;

  const [{ count: poLineCount }, { count: quoteLineCount }] = await Promise.all([
    supabase.from("purchase_order_lines").select("id", { count: "exact", head: true }).eq("inventory_item_id", id).eq("tenant_id", tenantId),
    supabase.from("quote_lines").select("id", { count: "exact", head: true }).eq("inventory_item_id", id).eq("tenant_id", tenantId),
  ]);
  if ((poLineCount ?? 0) > 0 || (quoteLineCount ?? 0) > 0) {
    return NextResponse.json({ error: "Cannot delete: this item is referenced by a purchase order or quote line." }, { status: 409 });
  }

  const { data: snap } = await supabase.from("inventory_items").select("name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { error } = await supabase
    .from("inventory_items")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (snap) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "inventory", objectId: id, objectLabel: snap.name,
      action: "delete", actorId: user?.id, actorEmail: user?.email,
    });
  }

  return new NextResponse(null, { status: 204 });
}
