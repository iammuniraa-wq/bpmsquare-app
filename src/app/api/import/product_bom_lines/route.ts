import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { fetchAllRows, insertRows, readImportBody, type PreparedRow } from "@/lib/import/server";
import { logChangeBatch, type ChangeLogEntryParams } from "@/lib/changeLog";
import { planBomImport, type BomImportProduct } from "@/lib/products/bomImport";
import { getTenantItemTypeConfig } from "@/lib/products/itemTypesServer";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import type { BomLine } from "@/lib/products/bom";
import type { RowOutcome } from "@/lib/import/types";

/**
 * Adds components to BOM / kit products that already exist. Everything is read
 * through fetchAllRows (tenant-scoped); each row is planned against the
 * tenant's products, the lines already there and the rows accepted earlier in
 * the same file (src/lib/products/bomImport.ts), so a loop that only appears
 * across two rows is refused. One change-log entry per touched kit.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "product_bom_lines");
  if (gate) return gate;
  if (!canEditWorkcenter(await resolvePermissions(supabase, tenantId, userId, role), "products")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [products, existing, config] = await Promise.all([
    fetchAllRows<BomImportProduct>(supabase, "products", "id, ref, sku, name, item_type, uom", tenantId),
    fetchAllRows<BomLine & { qty: number | string; scrap_pct: number | string }>(supabase, "product_bom_lines", "id, parent_product_id, component_product_id, qty, uom, scrap_pct, line_kind, sort_order", tenantId),
    getTenantItemTypeConfig(supabase, tenantId),
  ]);
  const plans = planBomImport(rows, products, existing.map((l) => ({ ...l, qty: Number(l.qty), scrap_pct: Number(l.scrap_pct) })), config);

  const outcomes: RowOutcome[] = [];
  const prepared: (PreparedRow & { parentId: string; componentId: string })[] = [];
  for (const plan of plans) {
    if (!plan.ok) { outcomes.push({ rowNum: plan.rowNum, status: "failed", reason: plan.reason }); continue; }
    prepared.push({
      rowNum: plan.rowNum, parentId: plan.parentId, componentId: plan.componentId,
      record: { tenant_id: tenantId, parent_product_id: plan.parentId, component_product_id: plan.componentId, ...plan.fields },
    });
  }
  if (prepared.length === 0) return NextResponse.json({ inserted: 0, skipped: 0, failed: outcomes.length, outcomes });

  const result = await insertRows(supabase, "product_bom_lines", prepared, outcomes);

  const insertedRows = new Set(result.outcomes.filter((o) => o.status === "inserted").map((o) => o.rowNum));
  const byParent = new Map<string, typeof prepared>();
  for (const p of prepared) if (insertedRows.has(p.rowNum)) byParent.set(p.parentId, [...(byParent.get(p.parentId) ?? []), p]);
  if (byParent.size > 0) {
    const nameById = new Map(products.map((p) => [p.id, p.name]));
    const user = await getAuthUser();
    const logRows: ChangeLogEntryParams[] = [...byParent].map(([parentId, added]) => ({
      tenantId, objectType: "products", objectId: parentId, objectLabel: nameById.get(parentId) ?? null,
      action: "update" as const, actorId: user?.id, actorEmail: user?.email,
      changes: added.map((a) => ({ field: "Component added", from: null, to: `${nameById.get(a.componentId) ?? "component"} × ${a.record.qty}${a.record.uom ? ` ${a.record.uom}` : ""}` })),
    }));
    await logChangeBatch(supabase, logRows);
  }
  return NextResponse.json(result);
}
