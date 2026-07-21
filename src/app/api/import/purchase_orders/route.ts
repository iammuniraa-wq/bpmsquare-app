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
  let supabase, tenantId, userId;
  try {
    ({ supabase, tenantId, userId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  const rows = readImportBody(await request.json());
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
  const yearEnd = new Date(now.getFullYear() + 1, 0, 1).toISOString();

  const [fieldConfig, salesConfig, suppliers, quotes, { count: existingCount }] = await Promise.all([
    getEffectiveFieldConfig(supabase, tenantId, "purchase_order"),
    getSalesConfig(supabase, tenantId),
    fetchAllRows<{ id: string; name: string }>(supabase, "suppliers", "id, name", tenantId),
    fetchAllRows<{ id: string; ref: string }>(supabase, "quotes", "id, ref", tenantId),
    supabase.from("purchase_orders").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).gte("created_at", yearStart).lt("created_at", yearEnd),
  ]);
  const spec = buildObjectSpec("purchase_orders", fieldConfig, salesConfig);
  const supplierByName = new Map(suppliers.map((s) => [nameKey(s.name), s.id]));
  const quoteByRef = new Map(quotes.map((q) => [nameKey(q.ref), q.id]));

  const prepared: PreparedRow[] = [];
  const outcomes: RowOutcome[] = [];
  let seq = (existingCount ?? 0) + 1;

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
    const supplierId = supplierByName.get(nameKey(v.supplier_name));
    if (!supplierId) {
      outcomes.push({
        rowNum,
        status: "failed",
        reason: `Supplier "${v.supplier_name}" was not found — import suppliers first`,
      });
      continue;
    }

    let quoteId: string | null = null;
    if (v.quote_ref) {
      quoteId = quoteByRef.get(nameKey(v.quote_ref)) ?? null;
      if (!quoteId) {
        outcomes.push({ rowNum, status: "failed", reason: `Quote "${v.quote_ref}" was not found` });
        continue;
      }
    }

    const custom = collectCustomData(values);
    const ref = `PO-${now.getFullYear()}-${String(seq).padStart(4, "0")}`;
    seq++;

    prepared.push({
      rowNum,
      record: {
        tenant_id: tenantId,
        ref,
        supplier_id: supplierId,
        quote_id: quoteId,
        status: "draft",
        order_date: v.order_date || null,
        expected_date: v.expected_date || null,
        notes: v.notes ?? null,
        terms: v.terms ?? null,
        total: 0,
        created_by: userId,
        ...(custom ? { custom_data: custom } : {}),
      },
    });
  }

  if (prepared.length === 0) return NextResponse.json(summarise(outcomes));
  return NextResponse.json(await insertRows(supabase, "purchase_orders", prepared, outcomes));
}
