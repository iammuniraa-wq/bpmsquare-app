import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, getAuthUser } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { fetchAllRows, readImportBody } from "@/lib/import/server";
import { summariseUpdate, updateRows, type PreparedUpdate } from "@/lib/import/updateServer";
import { logChangeBatch, type ChangeEntry, type ChangeLogEntryParams } from "@/lib/changeLog";
import { parseBomLineInput } from "@/lib/products/bomInput";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import type { RowOutcome } from "@/lib/import/types";

// The line's own fields only. Moving a line to another kit or component is a
// remove and an add (the pair is unique and loops are checked on add), and a
// name or SKU is never a key here: rows match on the line's Record ID.
const ALLOWED = ["qty", "uom", "scrap_pct", "line_kind", "note"] as const;
const LABEL: Record<string, string> = { qty: "Quantity", uom: "Unit", scrap_pct: "Scrap %", line_kind: "Kind", note: "Note" };

type Before = { id: string; parent_product_id: string; component_product_id: string; qty: number | string; uom: string | null; scrap_pct: number | string; line_kind: string; note: string | null };

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

  const prepared: PreparedUpdate[] = [];
  const outcomes: RowOutcome[] = [];

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }

    const body: Record<string, unknown> = {};
    for (const key of ALLOWED) if (key in values) body[key] = key === "line_kind" ? (values[key] || "").trim().toLowerCase() || undefined : values[key];
    // A blank cell leaves quantity and kind alone (they cannot be empty); unit and note clear.
    for (const key of ["qty", "scrap_pct", "line_kind"]) if (body[key] === "" || body[key] === undefined) delete body[key];
    if (Object.keys(body).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }

    const parsed = parseBomLineInput(body);
    if (!parsed.ok) { outcomes.push({ rowNum, status: "failed", reason: parsed.message }); continue; }
    prepared.push({ rowNum, id, patch: { ...parsed.fields, updated_at: new Date().toISOString() } });
  }

  if (prepared.length === 0) return NextResponse.json(summariseUpdate(outcomes));

  const { data: beforeRows } = await supabase
    .from("product_bom_lines")
    .select("id, parent_product_id, component_product_id, qty, uom, scrap_pct, line_kind, note")
    .in("id", prepared.map((p) => p.id))
    .eq("tenant_id", tenantId);
  const beforeById = new Map(((beforeRows ?? []) as Before[]).map((r) => [r.id, r]));

  const result = await updateRows(supabase, "product_bom_lines", tenantId, prepared, outcomes);

  const updated = result.outcomes.filter((o) => o.status === "updated").map((o) => prepared.find((p) => p.rowNum === o.rowNum)).filter((p): p is PreparedUpdate => !!p);
  if (updated.length > 0) {
    const names = new Map((await fetchAllRows<{ id: string; name: string }>(supabase, "products", "id, name", tenantId)).map((p) => [p.id, p.name]));
    const perParent = new Map<string, ChangeEntry[]>();
    for (const u of updated) {
      const b = beforeById.get(u.id);
      if (!b) continue;
      const entries: ChangeEntry[] = [];
      for (const [k, v] of Object.entries(u.patch)) {
        if (k === "updated_at") continue;
        const was = (b as unknown as Record<string, unknown>)[k];
        const same = k === "qty" || k === "scrap_pct" ? Number(was) === v : (was ?? null) === (v ?? null);
        if (!same) entries.push({ field: `${names.get(b.component_product_id) ?? "Component"}: ${LABEL[k] ?? k}`, from: was ?? null, to: v ?? null });
      }
      if (entries.length > 0) perParent.set(b.parent_product_id, [...(perParent.get(b.parent_product_id) ?? []), ...entries]);
    }
    if (perParent.size > 0) {
      const user = await getAuthUser();
      const logRows: ChangeLogEntryParams[] = [...perParent].map(([parentId, changes]) => ({
        tenantId, objectType: "products", objectId: parentId, objectLabel: names.get(parentId) ?? null,
        action: "update" as const, actorId: user?.id, actorEmail: user?.email, changes,
      }));
      await logChangeBatch(supabase, logRows);
    }
  }
  return NextResponse.json(result);
}
