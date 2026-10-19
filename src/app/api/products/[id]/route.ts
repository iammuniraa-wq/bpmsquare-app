import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { diffForLog, logChange } from "@/lib/changeLog";
import { parseCostSheet } from "@/lib/pricing/costSheet";
import { parseQtyBreaks } from "@/lib/sales/qtyBreaks";
import { writeHeaderTolerant } from "@/lib/pricing/quoteLineFlags";
import { checkItemTypeWrite } from "@/lib/products/itemTypesServer";
import { parseSupplierInput, supplierNamesById, verifySupplier, withSupplierNames } from "@/lib/products/supplier";

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
    .from("products")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The supplier's name rides along; no supplier_id key on the row = 0132 pending.
  if (!("supplier_id" in data)) return NextResponse.json(data);
  const names = await supplierNamesById(supabase, tenantId, [data.supplier_id]);
  return NextResponse.json({ ...data, supplier_name: data.supplier_id ? names.get(data.supplier_id) ?? null : null });
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

  const allowed = ["name", "sku", "category", "sub_category", "uom", "description", "list_price", "cost_price", "tax_percent", "status", "custom_data", "available_segment_ids", "cost_sheet", "cost_price_as_of", "qty_breaks"];
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in body) patch[key] = body[key];
  patch.updated_at = new Date().toISOString();

  // Quantity breaks (0118): well-formed rows only; none stored as null.
  if ("qty_breaks" in patch) {
    if (patch.qty_breaks !== null && !Array.isArray(patch.qty_breaks)) return NextResponse.json({ error: "qty_breaks must be an array" }, { status: 400 });
    const breaks = parseQtyBreaks(patch.qty_breaks);
    patch.qty_breaks = breaks.length > 0 ? breaks : null;
  }

  // Cost sheet (0113): only well-formed rows survive; an empty sheet is
  // stored as null ("one bought-in part at cost_price").
  if ("cost_sheet" in patch) {
    const rows = patch.cost_sheet === null ? [] : parseCostSheet(patch.cost_sheet);
    if (patch.cost_sheet !== null && !Array.isArray(patch.cost_sheet)) return NextResponse.json({ error: "cost_sheet must be an array" }, { status: 400 });
    patch.cost_sheet = rows.length > 0 ? rows : null;
  }
  if ("cost_price_as_of" in patch) {
    const v = patch.cost_price_as_of;
    if (v !== null && v !== "" && !(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v))) {
      return NextResponse.json({ error: "cost_price_as_of must be yyyy-mm-dd" }, { status: 400 });
    }
    patch.cost_price_as_of = v === "" ? null : v;
  }

  const { data: before } = await supabase
    .from("products")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  // item_type (0133): a key in this tenant's list; null / "" clears it. A kit that
  // still has components can't be changed to another type.
  if ("item_type" in body) {
    const itemType = await checkItemTypeWrite(supabase, tenantId, body.item_type, {
      productId: id,
      currentType: (before as { item_type?: string | null } | null)?.item_type ?? null,
    });
    if (!itemType.ok) return NextResponse.json({ error: itemType.message }, { status: 400 });
    patch.item_type = itemType.key;
  }

  // supplier_id (0132) is a foreign id from the request body: null clears it,
  // anything else must be one of this tenant's suppliers before it is saved.
  const supplier = parseSupplierInput(body);
  if (supplier.present) {
    if ("invalid" in supplier) return NextResponse.json({ error: "supplier_id is not a valid id" }, { status: 400 });
    if (supplier.id && !(await verifySupplier(supabase, tenantId, supplier.id))) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }
    patch.supplier_id = supplier.id;
  }

  // available_segment_ids (Coverage) are foreign ids from the request body --
  // verify each belongs to this tenant before writing (MULTI_TENANT_GUARDRAILS.md).
  if (Array.isArray(patch.available_segment_ids)) {
    const segIds = [...new Set((patch.available_segment_ids as unknown[]).filter((x): x is string => typeof x === "string"))];
    if (segIds.length > 0) {
      const { data: segRows } = await supabase.from("segments").select("id").eq("tenant_id", tenantId).in("id", segIds);
      if (!segRows || segRows.length !== segIds.length) {
        return NextResponse.json({ error: "One or more segments were not found" }, { status: 404 });
      }
    }
    patch.available_segment_ids = segIds;
  }

  // A pending 0132 drops supplier_id and retries instead of failing the save.
  const { data, error, strippedColumns } = await writeHeaderTolerant(patch, async (row) => {
    const r = await supabase.from("products").update(row).eq("id", id).eq("tenant_id", tenantId).select("*").single();
    return { data: r.data as Record<string, unknown> | null, error: r.error as { code?: string; message: string } | null };
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  for (const col of strippedColumns) delete patch[col];

  const user = await getAuthUser();
  const beforeRow = (before as Record<string, unknown>) ?? {};
  const supplierIds = [beforeRow.supplier_id, patch.supplier_id].filter((x): x is string => typeof x === "string");
  const changes = withSupplierNames(
    diffForLog("products", beforeRow, patch),
    await supplierNamesById(supabase, tenantId, supplierIds),
  );
  if (changes.length > 0) {
    await logChange(supabase, {
      tenantId, objectType: "products", objectId: id, objectLabel: (data as { name?: string }).name ?? null,
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

  const { data: snap } = await supabase.from("products").select("name").eq("id", id).eq("tenant_id", tenantId).maybeSingle();

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (snap) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "products", objectId: id, objectLabel: snap.name,
      action: "delete", actorId: user?.id, actorEmail: user?.email,
    });
  }

  return new NextResponse(null, { status: 204 });
}
