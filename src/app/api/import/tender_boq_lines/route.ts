import { NextResponse, type NextRequest } from "next/server";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { assertObjectFeature } from "@/lib/objectFeatures";
import { fetchAllRows, nameKey, readImportBody } from "@/lib/import/server";
import { boqDwGate } from "@/lib/import/tenderBoqServer";
import { applyBoqLines, boqRequestFor, insertDwSource } from "@/lib/tender/boq/server";
import { linesFromRows } from "@/lib/tender/boq/parse";
import type { ImportResponse, RowOutcome } from "@/lib/import/types";

type Row = { rowNum: number; values: Record<string, string> };

/**
 * Adds or revises the lines of an existing tender's Bill of quantities from a flat file, found by the deal's ID (OPP-0044) or the
 * tender number. Lines are matched by item number (else description and unit) like a revised Excel upload, but the import only ADDS
 * and UPDATES: a line the file does not mention is never removed or flagged (that rule belongs to the Upload BOQ screen alone, which
 * reads its file as the whole BOQ). A quantity that moved updates the deal line. A client rate in the file prices a line only where nobody priced it. No workbook is stored, so the
 * new source has an empty path; the answer sheet works, the priced-workbook download says why it cannot. One change-history entry
 * per tender. Cost and markup are not columns of this object.
 *
 * The parent is looked up in this workspace's own deals and tenders and re-checked through boqRequestFor (a tender deal of THIS
 * workspace, the caller's Pipeline edit grant); nothing about the tender is trusted from the file but its name. Every BOQ write
 * uses the service role (the tables have no write policy) with the workspace on every query.
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

  const body = (await request.json().catch(() => null)) as { rows?: unknown; fileName?: unknown } | null;
  const rows = readImportBody(body);
  if (!rows) return NextResponse.json({ error: "No rows provided" }, { status: 400 });
  const fileName = typeof body?.fileName === "string" ? body.fileName : "";

  const admin = createAdminSupabase();
  const [tenders, deals] = await Promise.all([
    fetchAllRows<{ opportunity_id: string; tender_no: string | null }>(admin, "opportunity_tenders", "opportunity_id, tender_no", tenantId),
    fetchAllRows<{ id: string; ref: string | null }>(admin, "opportunities", "id, ref", tenantId),
  ]);
  const tenderIds = new Set(tenders.map((t) => t.opportunity_id));
  const dealByRef = new Map(deals.filter((d) => d.ref).map((d) => [nameKey(d.ref!), d.id]));
  // A tender number used twice cannot name one tender: it is dropped from the map and said so on the row.
  const byNo = new Map<string, string | null>();
  for (const t of tenders) {
    if (!t.tender_no?.trim()) continue;
    const k = nameKey(t.tender_no);
    byNo.set(k, byNo.has(k) ? null : t.opportunity_id);
  }

  const outcomes: RowOutcome[] = [];
  const perTender = new Map<string, Row[]>();
  for (const row of rows as Row[]) {
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

  for (const [oppId, group] of perTender) {
    const failAll = (reason: string) => { for (const r of group) outcomes.push({ rowNum: r.rowNum, status: "failed", reason }); };
    const opened = await boqRequestFor(g.ctx, oppId, true);
    if (!opened.ok) { failAll(opened.status === 403 ? opened.error : "This tender could not be opened"); continue; }

    const { lines, failed } = linesFromRows(group);
    outcomes.push(...failed);
    if (lines.length === 0) continue;

    const source = await insertDwSource(opened.req, { fileName, lineCount: lines.length });
    if (!source.ok) { for (const l of lines) outcomes.push({ rowNum: l.row_no, status: "failed", reason: source.error }); continue; }
    const applied = await applyBoqLines(opened.req, lines, { id: source.sourceId, fileLabel: source.fileLabel, previous: source.previous, logField: "BOQ import (Data Workbench)", keepMissing: true });
    if (!applied.ok) { for (const l of lines) outcomes.push({ rowNum: l.row_no, status: "failed", reason: applied.error }); continue; }

    const added = new Set(applied.diff.added.map((l) => l.key));
    const changed = new Set(applied.diff.changed.map((c) => c.key));
    for (const l of lines) {
      if (added.has(l.key)) outcomes.push({ rowNum: l.row_no, status: "inserted" });
      else if (changed.has(l.key)) outcomes.push({ rowNum: l.row_no, status: "skipped", reason: "Already on the tender — updated by item number" });
      else outcomes.push({ rowNum: l.row_no, status: "skipped", reason: "Already on the tender — unchanged" });
    }
  }

  outcomes.sort((a, b) => a.rowNum - b.rowNum);
  return NextResponse.json({
    inserted: outcomes.filter((o) => o.status === "inserted").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  } satisfies ImportResponse);
}
