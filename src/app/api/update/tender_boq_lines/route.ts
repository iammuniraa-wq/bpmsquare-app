import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate } from "@/lib/import/updateServer";
import { boqDwGate } from "@/lib/import/tenderBoqServer";
import { TENDER_BOQ_UPDATE_KEYS } from "@/lib/import/tenderBoqLinesSchema";
import { boqRequestFor, editBoqLines, type EditBody } from "@/lib/tender/boq/server";
import { loadBoqRowsForApi } from "@/lib/tender/boq/apiRows";
import { parseNumber } from "@/lib/tender/boq/parse";
import type { RowOutcome } from "@/lib/import/types";

// What a file may NOT change on a line. A rate needs a source (the client's, a supplier, a past project...), so the Bill of quantities
// screen is the one place that sets it; the item number and unit are what the client's file said; the tender is the parent.
const NOT_BY_FILE = ["rate", "item_no", "unit", "tender_ref"] as const;
const may = (key: (typeof TENDER_BOQ_UPDATE_KEYS)[number]) => TENDER_BOQ_UPDATE_KEYS.includes(key);

/**
 * Bulk-edits lines already on a tender's Bill of quantities, matched by their own Record ID (the export's "id" column), never by
 * item number: an item number can repeat across tenders and a revised file can renumber. Quantity, description and cost code change
 * (the deal line's amount follows the quantity); a column that a file may not change is reported on the row, not applied. What the
 * client's file said is never touched, so a revised upload still compares against the file. Logged on the tender, like the screen's
 * own edits. Every query is on the workspace; an id of another workspace matches nothing.
 */
export async function POST(request: NextRequest) {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }

  // A tenant without the module cannot read or write its data in bulk either.
  const gate = await assertObjectFeature(tenantId, "tender_boq_lines");
  if (gate) return gate;
  const g = await boqDwGate(supabase, tenantId, userId, role, "edit");
  if (!g.ok) return g.response;

  const rows = readImportBody(await request.json().catch(() => null));
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const admin = createAdminSupabase();
  const ids = [...new Set(rows.map((r) => r.values.id?.trim()).filter((x): x is string => !!x))];
  const oppById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await admin.from("tender_boq_lines").select("id, opportunity_id").in("id", ids.slice(i, i + 150)).eq("tenant_id", tenantId);
    for (const l of (data ?? []) as { id: string; opportunity_id: string }[]) oppById.set(l.id, l.opportunity_id);
  }

  const outcomes: RowOutcome[] = [];
  const perTender = new Map<string, { rowNum: number; id: string; values: Record<string, string>; body: EditBody }[]>();

  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const oppId = oppById.get(id);
    if (!oppId) { outcomes.push({ rowNum, status: "failed", reason: `No record with id "${id}" found in this workspace` }); continue; }

    const body: EditBody = {};
    if (may("quantity") && values.quantity?.trim()) {
      const q = parseNumber(values.quantity);
      if (q == null) { outcomes.push({ rowNum, status: "failed", reason: "quantity must be a number" }); continue; }
      body.qty = q;
    }
    if (may("description") && "description" in values) body.description = values.description ?? "";
    if (may("cost_code") && "cost_code" in values) body.cost_code = values.cost_code?.trim() || null;
    if (Object.keys(body).length === 0) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    (perTender.get(oppId) ?? perTender.set(oppId, []).get(oppId)!).push({ rowNum, id, values, body });
  }

  for (const [oppId, group] of perTender) {
    const opened = await boqRequestFor(g.ctx, oppId, true);
    if (!opened.ok) {
      for (const r of group) outcomes.push({ rowNum: r.rowNum, status: "failed", reason: opened.status === 403 ? opened.error : "This tender could not be opened" });
      continue;
    }
    const done = await editBoqLines(opened.req, group.map((r) => ({ boqId: r.id, body: r.body })));

    // The columns a file cannot change are only worth a word where they differ from what is there (an export carries them all).
    const wanted = group.some((r) => NOT_BY_FILE.some((k) => r.values[k]?.trim()));
    const current = wanted ? new Map((await loadBoqRowsForApi(admin, tenantId, oppId)).rows.map((x) => [String(x.id), x])) : null;
    const differs = (r: (typeof group)[number]): string[] => {
      const now = current?.get(r.id);
      if (!now) return [];
      return NOT_BY_FILE.filter((k) => {
        const v = r.values[k]?.trim();
        if (!v) return false;
        if (k === "rate") return Number(v.replace(/,/g, "")) !== Number(now.rate ?? 0);
        const have = k === "tender_ref" ? now.tender_ref : now[k];
        return String(have ?? "").trim().toLowerCase() !== v.toLowerCase();
      });
    };

    group.forEach((r, i) => {
      const o = done[i];
      const note = differs(r);
      const noted = note.length > 0 ? `${note.join(", ")} ${note.length === 1 ? "is" : "are"} not changed by a file${note.includes("rate") ? " (a rate is set on the Bill of quantities)" : ""}` : undefined;
      if (!o.ok) outcomes.push({ rowNum: r.rowNum, status: "failed", reason: o.error });
      else if (!o.changed) outcomes.push({ rowNum: r.rowNum, status: "skipped", reason: noted ? `No change. ${noted}` : "No change" });
      else outcomes.push({ rowNum: r.rowNum, status: "updated", ...(noted ? { reason: noted } : {}) });
    });
  }

  return NextResponse.json(summariseUpdate(outcomes));
}
