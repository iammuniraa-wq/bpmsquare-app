import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { readImportBody } from "@/lib/import/server";
import { parseQtyBreaksText } from "@/lib/products/qtyBreaks";
import { itemTypeFromCell } from "@/lib/products/itemTypes";
import { getTenantItemTypeConfig, kitsWithComponents } from "@/lib/products/itemTypesServer";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import type { RowOutcome } from "@/lib/import/types";

// Mirrors src/app/api/products/[id]/route.ts PATCH -- supplier_id excluded: a
// relationship changes on the record (and Update never keys off a name), so the
// Supplier column is Import/Export only.
const ALLOWED = ["name", "sku", "category", "sub_category", "uom", "description", "list_price", "cost_price", "tax_percent", "status", "item_type", "custom_data", "qty_breaks"];

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

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];
  const itemTypeConfig = await getTenantItemTypeConfig(supabase, tenantId);
  // A kit that still has components can't be changed to another type, same as
  // on the record: look the whole file's kits up in two queries.
  const withComponents = await kitsWithComponents(
    supabase, tenantId,
    rows.filter((r) => "item_type" in r.values && r.values.id?.trim()).map((r) => r.values.id.trim()),
  );
  const currentTypes = new Map<string, string | null>();
  if (withComponents.size > 0) {
    const { data } = await supabase.from("products").select("id, item_type").eq("tenant_id", tenantId).in("id", [...withComponents.keys()]);
    for (const p of data ?? []) currentTypes.set((p as { id: string }).id, (p as { item_type: string | null }).item_type);
  }

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) {
      outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" });
      continue;
    }

    const patch: Record<string, unknown> = {};
    for (const key of ALLOWED) if (key in values) patch[key] = values[key] || null;

    // A blank cell clears the scales; anything else must be a valid price-list text.
    if ("qty_breaks" in patch) {
      const breaks = parseQtyBreaksText(values.qty_breaks);
      if (!breaks.ok) { outcomes.push({ rowNum, status: "failed", reason: `Quantity breaks: ${breaks.error}` }); continue; }
      patch.qty_breaks = breaks.breaks.length > 0 ? breaks.breaks : null;
    }

    if ("item_type" in patch) {
      const t = itemTypeFromCell(itemTypeConfig, values.item_type ?? "");
      if (!t.ok) { outcomes.push({ rowNum, status: "failed", reason: t.message }); continue; }
      const n = withComponents.get(id);
      if (n && currentTypes.get(id) === "bom_kit" && t.key !== "bom_kit") {
        outcomes.push({ rowNum, status: "failed", reason: `This item has ${n} component${n === 1 ? "" : "s"}. Remove them first: only BOM / kit items can have components.` });
        continue;
      }
      patch.item_type = t.key;
    }

    if (Object.keys(patch).length === 0) {
      outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" });
      continue;
    }

    prepared.push({ rowNum, id, patch });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));
  const user = await getAuthUser();
  return NextResponse.json(await updateRows(supabase, "products", tenantId, prepared, outcomes, {
    objectType: "products", labelField: "name", actorId: user?.id, actorEmail: user?.email,
  }));
}
