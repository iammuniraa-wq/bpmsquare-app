import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { nextMasterRefSeq, formatMasterRef } from "@/lib/masterRef";
import { getEffectiveFieldConfig, getSalesConfig } from "@/lib/fieldConfig";
import { buildObjectSpec } from "@/lib/import/registrySchema";
import { validateRow, hasBlockingIssue } from "@/lib/import/validate";
import {
  collectCustomData,
  fetchAllRows,
  insertRows,
  readImportBody,
  summarise,
  type PreparedRow,
} from "@/lib/import/server";
import { resolveSupplierName, supplierColumnAvailable, withoutSupplierFields } from "@/lib/products/supplier";
import type { RowOutcome } from "@/lib/import/types";

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

  // A tenant without the module cannot read or write its data in bulk
  // either -- the gate is the same question the nav and the v1 API ask.
  const gate = await assertObjectFeature(tenantId, "products");
  if (gate) return gate;

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  // Supplier names resolve against THIS tenant's suppliers only
  // (fetchAllRows filters on tenant_id); while migration 0132 is pending the
  // Supplier column is not offered at all, so nothing is silently dropped.
  const [fieldConfig, salesConfig, suppliers, supplierOn] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "product"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "suppliers", "id, name", tenantId),
    supplierColumnAvailable(supabase),
  ]);
  const built = buildObjectSpec("products", fieldConfig, salesConfig);
  const spec = supplierOn ? built : withoutSupplierFields(built);

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];

  let refSeq = await nextMasterRefSeq(supabase, "products", tenantId);

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
      const match = resolveSupplierName(v.supplier_name, suppliers);
      if (!match.ok) {
        outcomes.push({
          rowNum,
          status: "failed",
          reason: match.reason === "ambiguous"
            ? `Supplier "${v.supplier_name}" matches more than one supplier — rename one, or leave the column blank`
            : `Supplier "${v.supplier_name}" was not found — import suppliers first, or leave the column blank`,
        });
        continue;
      }
      supplierId = match.id;
    }

    const custom = collectCustomData(values);

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        ref: formatMasterRef("products", refSeq++),
        name: v.name,
        sku: v.sku ?? null,
        category: v.category ?? null,
        sub_category: v.sub_category ?? null,
        uom: v.uom ?? null,
        description: v.description ?? null,
        list_price: num(v.list_price),
        cost_price: num(v.cost_price),
        tax_percent: num(v.tax_percent),
        status: v.status || "active",
        // Named only when set: a database without 0132 is never asked for it.
        ...(supplierId ? { supplier_id: supplierId } : {}),
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await insertRows(supabase, "products", prepared, outcomes, {
    objectType: "products", labelField: "name", actorId: user?.id, actorEmail: user?.email,
  }));
}
