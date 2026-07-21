import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser } from "@/lib/supabase-server";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import {
  collectCustomData,
  fetchAllRows,
  insertRows,
  nameKey,
  readImportBody,
  summarise,
  type PreparedRow,
} from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";

export async function POST(request: NextRequest) {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const [fieldConfig, salesConfig, suppliers] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "inventory"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "suppliers", "id, name", tenantId),
  ]);
  const spec = buildObjectSpec("inventory", fieldConfig, salesConfig);
  const supplierByName = new Map(suppliers.map((s) => [nameKey(s.name), s.id]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const validated = validateRow(spec, values, rowNum);
    if (hasBlockingIssue(validated)) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: validated.issues.filter((i) => i.severity === "error").map((i) => i.message).join("; "),
      });
      continue;
    }

    const v = validated.values;

    let supplierId: string | null = null;
    if (v.supplier_name) {
      supplierId = supplierByName.get(nameKey(v.supplier_name)) ?? null;
      if (!supplierId) {
        outcomes.push({
          rowNum,
          status: "failed",
          reason: `Supplier "${v.supplier_name}" was not found — import suppliers first, or leave the column blank`,
        });
        continue;
      }
    }

    const custom = collectCustomData(values);

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        name: v.name,
        sku: v.sku ?? null,
        description: v.description ?? null,
        category: v.category ?? null,
        uom: v.uom || "Nos",
        supplier_id: supplierId,
        reorder_level: v.reorder_level ? Number(v.reorder_level) : null,
        unit_cost: v.unit_cost ? Number(v.unit_cost) : null,
        status: v.status || "active",
        notes: v.notes ?? null,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  return NextResponse.json(await insertRows(supabase, "inventory_items", prepared, outcomes));
}
