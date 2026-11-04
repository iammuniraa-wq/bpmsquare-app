import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { readImportBody } from "@/lib/import/server";
import { summariseUpdate } from "@/lib/import/updateServer";
import { boqDwGate } from "@/lib/import/tenderBoqServer";
import { employeeEmails, itemByCode } from "@/lib/import/tenderWbsServer";
import { TENDER_WBS_UPDATE_KEYS } from "@/lib/import/tenderWbsItemsSchema";
import { isMissingSchema } from "@/lib/tender/server";
import { boqRequestFor } from "@/lib/tender/boq/server";
import { updateItem, wbsCtx } from "@/lib/tender/wbs/server";
import { loadItems } from "@/lib/tender/wbs/read";
import { cleanText, WBS_LIMITS } from "@/lib/wbs/tree";
import { WBS_PENDING } from "@/lib/wbs/tips";
import type { RowOutcome } from "@/lib/import/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const may = (key: (typeof TENDER_WBS_UPDATE_KEYS)[number]) => TENDER_WBS_UPDATE_KEYS.includes(key);

/**
 * Bulk-edits WBS items already on a tender, matched by their own Record ID (the export's "id" column), never by code: a code can be retyped
 * and renumbering moves auto codes. Name, code, parent (by its code), owner (by email) and note change, through updateItem, the writer the
 * screen uses: the three-level limit, the cycle rule, the unique code and the change history are the screen's own. A value that says what
 * the item already has is "No change", so an export can be edited and loaded back. An item of another workspace, or of a tender the caller
 * cannot edit, matches nothing.
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
  const gate = await assertObjectFeature(tenantId, "tender_wbs_items");
  if (gate) return gate;
  const g = await boqDwGate(supabase, tenantId, userId, role, "edit");
  if (!g.ok) return g.response;

  const rows = readImportBody(await request.json().catch(() => null));
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });

  const admin = createAdminSupabase();
  const outcomes: RowOutcome[] = [];
  // Only well-formed ids reach the database: one malformed cell would otherwise fail the whole lookup.
  const ids = [...new Set(rows.map((r) => r.values.id?.trim()).filter((x): x is string => !!x && UUID.test(x)))];
  const oppById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await admin.from("tender_wbs_items").select("id, opportunity_id").in("id", ids.slice(i, i + 150)).eq("tenant_id", tenantId);
    if (error && isMissingSchema(error)) return NextResponse.json({ error: WBS_PENDING }, { status: 503 });
    for (const l of (data ?? []) as { id: string; opportunity_id: string }[]) oppById.set(l.id, l.opportunity_id);
  }

  const perTender = new Map<string, { rowNum: number; id: string; values: Record<string, string> }[]>();
  for (const { rowNum, values } of rows) {
    const id = values.id?.trim();
    if (!id) { outcomes.push({ rowNum, status: "failed", reason: "Record ID is required to update a row" }); continue; }
    const oppId = oppById.get(id);
    if (!oppId) { outcomes.push({ rowNum, status: "failed", reason: `No record with id "${id}" found in this workspace` }); continue; }
    if (!TENDER_WBS_UPDATE_KEYS.some((k) => k in values)) { outcomes.push({ rowNum, status: "skipped", reason: "No mapped columns to update" }); continue; }
    (perTender.get(oppId) ?? perTender.set(oppId, []).get(oppId)!).push({ rowNum, id, values });
  }

  const wantsOwner = rows.some((r) => r.values.owner_email?.trim());
  const emails = wantsOwner ? await employeeEmails(admin, tenantId) : null;

  for (const [oppId, group] of perTender) {
    const opened = await boqRequestFor(g.ctx, oppId, true);
    if (!opened.ok) {
      for (const r of group) outcomes.push({ rowNum: r.rowNum, status: "failed", reason: opened.status === 403 ? opened.error : "This tender could not be opened" });
      continue;
    }
    const ctx = wbsCtx(opened.req);

    for (const r of group) {
      // Read fresh each time: an earlier row of this file may have moved an item or renumbered the tree.
      const { items } = await loadItems(admin, tenantId, oppId);
      const cur = items.find((i) => i.id === r.id);
      if (!cur) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: "WBS item not found" }); continue; }

      const input: Record<string, unknown> = {};
      let changed = false;
      let bad: string | null = null;
      if (may("name") && "name" in r.values) {
        const name = cleanText(r.values.name, WBS_LIMITS.nameMax);
        if (!name) bad = "Give the WBS item a name";
        else if (name !== cur.name) { input.name = name; changed = true; }
      }
      if (!bad && may("code") && r.values.code?.trim()) {
        const code = cleanText(r.values.code, WBS_LIMITS.codeMax);
        if (code && code !== cur.code) { input.code = code; changed = true; }
      }
      if (!bad && may("parent_code") && "parent_code" in r.values) {
        const pc = r.values.parent_code?.trim() ?? "";
        const parent = pc ? itemByCode(items, pc) : null;
        if (pc && !parent) bad = `Parent WBS ${pc} does not exist on this tender`;
        else if ((parent?.id ?? null) !== cur.parent_id) { input.parent_id = parent?.id ?? null; changed = true; }
      }
      if (!bad && may("owner_email") && "owner_email" in r.values) {
        const email = r.values.owner_email?.trim() ?? "";
        const owner = email ? emails?.byEmail.get(email.toLowerCase()) ?? null : null;
        if (email && !owner) bad = `No active employee with the email ${email}`;
        else if (owner !== cur.owner_employee_id) { input.owner_employee_id = owner; changed = true; }
      }
      if (!bad && may("note") && "note" in r.values) {
        const note = cleanText(r.values.note, WBS_LIMITS.noteMax);
        if (note !== cur.note) { input.note = note; changed = true; }
      }
      if (bad) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: bad }); continue; }
      if (!changed) { outcomes.push({ rowNum: r.rowNum, status: "skipped", reason: "No change" }); continue; }
      const res = await updateItem(ctx, r.id, input);
      outcomes.push(res.ok ? { rowNum: r.rowNum, status: "updated" } : { rowNum: r.rowNum, status: "failed", reason: res.error });
    }
  }

  outcomes.sort((a, b) => a.rowNum - b.rowNum);
  return NextResponse.json(summariseUpdate(outcomes));
}
