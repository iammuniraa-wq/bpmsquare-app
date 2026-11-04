import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { readImportBody } from "@/lib/import/server";
import { boqDwGate } from "@/lib/import/tenderBoqServer";
import { employeeEmails, groupRowsByTender, itemByCode } from "@/lib/import/tenderWbsServer";
import { boqRequestFor } from "@/lib/tender/boq/server";
import { createItem, wbsCtx } from "@/lib/tender/wbs/server";
import { loadStructure } from "@/lib/tender/wbs/read";
import { WBS_PENDING } from "@/lib/wbs/tips";
import type { ImportResponse, RowOutcome } from "@/lib/import/types";

type Row = { rowNum: number; values: Record<string, string> };

/**
 * Adds WBS items to an existing tender from a flat file (an ERP's WBS can be pasted in), found by the deal's ID (OPP-0044) or the tender
 * number. Import only ADDS: an item whose code is already on the tender is left alone and said so, so loading the same file twice adds
 * nothing; a row with no code is always a new, auto-numbered item. A parent is named by its code and may be an earlier row of the same file in
 * any order. The owner is an active employee found by email. Items are made by createItem, the writer the screen uses, so the three-level
 * limit, the 500-item limit, the unique code and the change history are the screen's own. Which lines sit in an item is the BOQ lines
 * object's WBS code, never this file.
 *
 * The parent is looked up in this workspace's own deals and tenders and re-checked through boqRequestFor (a tender deal of THIS workspace,
 * the caller's Pipeline edit grant); nothing is trusted from the file but names. Every write uses the service role with the workspace on
 * every query.
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
  const perTender = await groupRowsByTender(admin, tenantId, rows as Row[], outcomes);
  const wantsOwner = (rows as Row[]).some((r) => r.values.owner_email?.trim());
  const emails = wantsOwner ? await employeeEmails(admin, tenantId) : null;

  for (const [oppId, group] of perTender) {
    const failAll = (reason: string) => { for (const r of group) outcomes.push({ rowNum: r.rowNum, status: "failed", reason }); };
    const opened = await boqRequestFor(g.ctx, oppId, true);
    if (!opened.ok) { failAll(opened.status === 403 ? opened.error : "This tender could not be opened"); continue; }
    const ctx = wbsCtx(opened.req);
    const st = await loadStructure(admin, tenantId, oppId);
    if (st.pending) { failAll(WBS_PENDING); continue; }

    const items = [...st.items];
    let waiting: Row[] = [];
    for (const r of group) {
      if (!r.values.name?.trim()) outcomes.push({ rowNum: r.rowNum, status: "failed", reason: "Name is required" });
      else waiting.push(r);
    }
    const inFile = new Set(waiting.map((r) => r.values.code?.trim().toLowerCase()).filter((c): c is string => !!c));

    // Rows whose parent is not made yet wait for a later pass, so a file may list children before their parents.
    for (let pass = 0; pass < 5 && waiting.length > 0; pass++) {
      const next: Row[] = [];
      let progressed = false;
      for (const r of waiting) {
        const code = r.values.code?.trim() ?? "";
        if (code && itemByCode(items, code)) { outcomes.push({ rowNum: r.rowNum, status: "skipped", reason: `WBS ${code} is already on the tender` }); progressed = true; continue; }
        const parentCode = r.values.parent_code?.trim() ?? "";
        let parentId: string | null = null;
        if (parentCode) {
          const parent = itemByCode(items, parentCode);
          if (!parent) {
            if (inFile.has(parentCode.toLowerCase())) { next.push(r); continue; }
            outcomes.push({ rowNum: r.rowNum, status: "failed", reason: `Parent WBS ${parentCode} does not exist on this tender` }); progressed = true; continue;
          }
          parentId = parent.id;
        }
        const email = r.values.owner_email?.trim() ?? "";
        let ownerId: string | null = null;
        if (email) {
          ownerId = emails?.byEmail.get(email.toLowerCase()) ?? null;
          if (!ownerId) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: `No active employee with the email ${email}` }); progressed = true; continue; }
        }
        const res = await createItem(ctx, { code: code || undefined, name: r.values.name, parent_id: parentId, owner_employee_id: ownerId, note: r.values.note?.trim() || undefined });
        progressed = true;
        if (!res.ok) { outcomes.push({ rowNum: r.rowNum, status: "failed", reason: res.error }); continue; }
        outcomes.push({ rowNum: r.rowNum, status: "inserted" });
        items.push({ id: res.id, opportunity_id: oppId, parent_id: parentId, code: res.code, name: r.values.name, owner_employee_id: ownerId, sort_order: 0, code_is_manual: !!code, note: null, created_at: null });
      }
      waiting = next;
      if (!progressed) break;
    }
    for (const r of waiting) outcomes.push({ rowNum: r.rowNum, status: "failed", reason: `Parent WBS ${r.values.parent_code?.trim()} could not be created first` });
  }

  outcomes.sort((a, b) => a.rowNum - b.rowNum);
  return NextResponse.json({
    inserted: outcomes.filter((o) => o.status === "inserted").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  } satisfies ImportResponse);
}
