import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows, nameKey } from "@/lib/import/server";
import type { RowOutcome } from "@/lib/import/types";
import { assignLines, setLineSplit, type WbsCtx } from "@/lib/tender/wbs/server";
import { loadStructure } from "@/lib/tender/wbs/read";
import { parseWbsCell, sameShares } from "@/lib/tender/wbs/apiShape";
import { isLeaf, partsOf } from "@/lib/wbs/tree";
import { WBS_PENDING } from "@/lib/wbs/tips";

// The WBS column of a Data Workbench Update on a tender's BOQ lines (docs/design/wbs.md section 5). The cell is read by parseWbsCell (the one
// text format every surface uses), checked against THIS tender's items, and applied through the same writers the screen uses (assignLines,
// setLineSplit), so the leaf rule, the 100 % rule, the tenant and deal checks and the change log are the screen's own. Lines are the ones
// the route already matched by real id on this tender; an item or a line of another tender cannot be named (it is simply "not on this tender").

export type WbsRowResult = { status: "updated" | "skipped" | "failed"; reason?: string };

export async function applyWbsCells(ctx: WbsCtx, rows: readonly { boqId: string; cell: string }[]): Promise<WbsRowResult[]> {
  const out: WbsRowResult[] = rows.map(() => ({ status: "skipped", reason: "No change" }));
  if (rows.length === 0) return out;
  const st = await loadStructure(ctx.admin, ctx.tenantId, ctx.opportunityId);
  if (st.pending) {
    rows.forEach((r, i) => { if (r.cell.trim()) out[i] = { status: "failed", reason: WBS_PENDING }; });
    return out;
  }

  const whole = new Map<string | null, number[]>();
  const splits: { i: number; boqId: string; parts: { wbs_item_id: string; share_pct: number }[] }[] = [];
  const codeOf = (id: string) => st.items.find((x) => x.id === id)?.code ?? "?";

  const seen = new Set<string>();
  rows.forEach((r, i) => {
    if (!st.members.item.has(r.boqId)) { out[i] = { status: "failed", reason: "Line not found" }; return; }
    if (seen.has(r.boqId)) { out[i] = { status: "failed", reason: "This line is in the file twice" }; return; }
    const cell = parseWbsCell(r.cell, st.items);
    const have = partsOf({ wbs_item_id: st.members.item.get(r.boqId) ?? null, parts: st.members.parts.get(r.boqId) ?? [] });
    // A left-over share (an item was removed) is exported as it stands, under 100: loaded back unchanged it is not a mistake.
    if (!cell.ok && cell.partial && sameShares(cell.partial, have)) return;
    if (!cell.ok) { out[i] = { status: "failed", reason: cell.error }; return; }
    if (cell.kind === "clear") {
      if (have.length === 0) return;
      seen.add(r.boqId);
      (whole.get(null) ?? whole.set(null, []).get(null)!).push(i);
      return;
    }
    // A file that carries back what an export wrote is not a change, even when that was a left-over share after an item was removed.
    if (sameShares(cell.shares, have)) return;
    if (cell.shares.length === 1) {
      const id = cell.shares[0].wbs_item_id;
      if (!isLeaf(st.items, id)) { out[i] = { status: "failed", reason: `WBS ${codeOf(id)} has sub-items. Choose one of them` }; return; }
      seen.add(r.boqId);
      (whole.get(id) ?? whole.set(id, []).get(id)!).push(i);
      return;
    }
    seen.add(r.boqId);
    splits.push({ i, boqId: r.boqId, parts: cell.shares });
  });

  for (const [target, idx] of whole) {
    const res = await assignLines(ctx, idx.map((i) => rows[i].boqId), target);
    for (const i of idx) out[i] = res.ok ? { status: "updated" } : { status: "failed", reason: res.error };
  }
  for (const s of splits) {
    const res = await setLineSplit(ctx, s.boqId, s.parts);
    out[s.i] = res.ok ? { status: "updated" } : { status: "failed", reason: res.error };
  }
  return out;
}

// ── Shared by the three tender_wbs_items routes ─────────────────────────────────────────────────────────────────────

/**
 * Finds the tender of each row by Deal ID or tender number, in THIS workspace only, and groups the rows by tender. A row whose tender cannot
 * be named is failed on `outcomes` with the reason; the rest are returned. The same wording as the Tender BOQ lines import.
 */
export async function groupRowsByTender<R extends { rowNum: number; values: Record<string, string> }>(
  admin: SupabaseClient, tenantId: string, rows: readonly R[], outcomes: RowOutcome[],
): Promise<Map<string, R[]>> {
  const [tenders, deals] = await Promise.all([
    fetchAllRows<{ opportunity_id: string; tender_no: string | null }>(admin, "opportunity_tenders", "opportunity_id, tender_no", tenantId),
    fetchAllRows<{ id: string; ref: string | null }>(admin, "opportunities", "id, ref", tenantId),
  ]);
  const tenderIds = new Set(tenders.map((t) => t.opportunity_id));
  const dealByRef = new Map(deals.filter((d) => d.ref).map((d) => [nameKey(d.ref!), d.id]));
  const byNo = new Map<string, string | null>();
  for (const t of tenders) {
    if (!t.tender_no?.trim()) continue;
    const k = nameKey(t.tender_no);
    byNo.set(k, byNo.has(k) ? null : t.opportunity_id);
  }
  const perTender = new Map<string, R[]>();
  for (const row of rows) {
    const ref = (row.values.tender_ref ?? "").trim();
    if (!ref) { outcomes.push({ rowNum: row.rowNum, status: "failed", reason: "Tender is required (Deal ID or tender number)" }); continue; }
    const key = nameKey(ref);
    let oppId = dealByRef.get(key) ?? null;
    if (!oppId && byNo.has(key)) {
      oppId = byNo.get(key) ?? null;
      if (!oppId) { outcomes.push({ rowNum: row.rowNum, status: "failed", reason: "Tender number is not unique — use the Deal ID" }); continue; }
    }
    if (!oppId) { outcomes.push({ rowNum: row.rowNum, status: "failed", reason: `Tender "${ref}" was not found. Check the Deal ID or tender number against an export of Deals` }); continue; }
    if (!tenderIds.has(oppId)) { outcomes.push({ rowNum: row.rowNum, status: "failed", reason: `"${ref}" is not a tender` }); continue; }
    (perTender.get(oppId) ?? perTender.set(oppId, []).get(oppId)!).push(row);
  }
  return perTender;
}

/** Active employees of the workspace by lower-cased email, and the reverse (id to email) for the export. */
export async function employeeEmails(admin: SupabaseClient, tenantId: string): Promise<{ byEmail: Map<string, string>; emailOf: Map<string, string> }> {
  const emps = await fetchAllRows<{ id: string; email: string | null; status: string | null }>(admin, "employees", "id, email, status", tenantId);
  const byEmail = new Map<string, string>();
  const emailOf = new Map<string, string>();
  for (const e of emps) {
    if (!e.email?.trim()) continue;
    emailOf.set(e.id, e.email.trim());
    if (e.status === "active") byEmail.set(e.email.trim().toLowerCase(), e.id);
  }
  return { byEmail, emailOf };
}

/** An item by the code a file names: the exact code, else a case-insensitive match when only one item has it. */
export function itemByCode<T extends { id: string; code: string }>(items: readonly T[], code: string): T | undefined {
  const exact = items.find((i) => i.code === code);
  if (exact) return exact;
  const loose = items.filter((i) => i.code.toLowerCase() === code.toLowerCase());
  return loose.length === 1 ? loose[0] : undefined;
}
