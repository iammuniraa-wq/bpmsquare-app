import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { insertWithMasterRef } from "@/lib/masterRef";
import { diffForLog, logChange } from "@/lib/changeLog";
import { writeHeaderTolerant } from "@/lib/pricing/quoteLineFlags";
import { checkItemTypeWrite } from "@/lib/products/itemTypesServer";
import { parseSupplierInput, rowsCarrySupplier, supplierNamesById, verifySupplier, withSupplierNames } from "@/lib/products/supplier";

export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];
  // The preferred supplier's name rides along (a second tenant-scoped query,
  // not a join, so a database without 0132 still answers). No supplier_id key
  // on the rows = 0132 pending: nothing to add.
  if (!rowsCarrySupplier(rows)) return NextResponse.json(rows);
  const names = await supplierNamesById(supabase, tenantId, rows.map((r) => r.supplier_id));
  return NextResponse.json(rows.map((r) => ({ ...r, supplier_name: r.supplier_id ? names.get(r.supplier_id) ?? null : null })));
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const body = await request.json();
  const { name, sku, category, sub_category, uom, description } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // supplier_id is a foreign id from the request body: it must be one of this
  // tenant's suppliers before it is stored.
  const supplier = parseSupplierInput(body);
  if (supplier.present && "invalid" in supplier) {
    return NextResponse.json({ error: "supplier_id is not a valid id" }, { status: 400 });
  }
  const supplierId = supplier.present && "id" in supplier ? supplier.id : null;
  if (supplierId && !(await verifySupplier(supabase, tenantId, supplierId))) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // item_type must be a key in THIS tenant's list (config.item_types); empty = unclassified.
  const itemType = await checkItemTypeWrite(supabase, tenantId, body.item_type);
  if (!itemType.ok) return NextResponse.json({ error: itemType.message }, { status: 400 });

  const record: Record<string, unknown> = {
    tenant_id: tenantId,
    name: name.trim(),
    sku: sku || null,
    category: category || null,
    sub_category: sub_category || null,
    uom: uom || null,
    description: description || null,
    list_price: num(body.list_price),
    cost_price: num(body.cost_price),
    tax_percent: num(body.tax_percent),
    status: "active",
    // Only named when set, so a database without 0132 is never asked for it.
    ...(supplierId ? { supplier_id: supplierId } : {}),
    ...(itemType.key ? { item_type: itemType.key } : {}),
  };

  // A pending 0132 drops supplier_id and retries instead of failing the create.
  const { data, error, strippedColumns } = await writeHeaderTolerant(record, (row) =>
    insertWithMasterRef(supabase, "products", tenantId, row, "*")
  );
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  const saved = { ...record };
  for (const col of strippedColumns) delete saved[col];

  const user = await getAuthUser();
  await logChange(supabase, {
    tenantId, objectType: "products", objectId: data.id, objectLabel: data.name,
    action: "create", actorId: user?.id, actorEmail: user?.email,
    changes: withSupplierNames(
      diffForLog("products", {}, saved),
      await supplierNamesById(supabase, tenantId, [supplierId]),
    ),
  });

  return NextResponse.json(data, { status: 201 });
}
