import type { SupabaseClient } from "@supabase/supabase-js";

import { readAllPages } from "@/lib/pagedRead";
// Where the deal's Lines editor and the BOQ meet. A tender deal's lines are ordinary opportunity_lines; the BOQ rows say which
// row of the client's file each came from. Everything here is tenant-scoped and tolerates migration 0223 being pending (a missing
// table reads as "this deal has no BOQ"). Kept out of the standard deal files on purpose: they call it only for a tender deal.

/** The deal has an uploaded BOQ (a current source). */
export async function dealHasBoq(admin: SupabaseClient, tenantId: string, oppId: string): Promise<boolean> {
  const { data, error } = await admin.from("tender_boq_sources").select("id").eq("tenant_id", tenantId).eq("opportunity_id", oppId).eq("is_current", true).limit(1);
  return !error && (data?.length ?? 0) > 0;
}

/** deal line id -> the row number in the client's file. */
export async function boqRowOrder(admin: SupabaseClient, tenantId: string, oppId: string): Promise<Map<string, number>> {
  const { data, error } = await readAllPages((lo, hi) => admin.from("tender_boq_lines").select("line_id, row_no").eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("id", { ascending: true }).range(lo, hi));
  const out = new Map<string, number>();
  if (error) return out;
  for (const r of (data ?? []) as { line_id: string | null; row_no: number }[]) if (r.line_id) out.set(r.line_id, Number(r.row_no));
  return out;
}

/** The client's order: lines that came from the file follow its row numbers; any other line (added by hand) comes after, in its given order. */
export function orderByBoq<T extends { id: string }>(lines: readonly T[], rowOf: ReadonlyMap<string, number>): T[] {
  if (rowOf.size === 0) return [...lines];
  const linked = lines.filter((l) => rowOf.has(l.id)).sort((a, b) => rowOf.get(a.id)! - rowOf.get(b.id)!);
  return [...linked, ...lines.filter((l) => !rowOf.has(l.id))];
}

/** A tender deal's lines in the order of the client's file. */
export async function boqOrderedLines<T extends { id: string }>(admin: SupabaseClient, tenantId: string, oppId: string, lines: readonly T[]): Promise<T[]> {
  return orderByBoq(lines, await boqRowOrder(admin, tenantId, oppId));
}

/** deal line id -> BOQ row id, read BEFORE the editor's save deletes the lines (the delete clears line_id on the BOQ rows). */
export async function snapshotBoqLinks(admin: SupabaseClient, tenantId: string, oppId: string): Promise<Map<string, string>> {
  const { data, error } = await readAllPages((lo, hi) => admin.from("tender_boq_lines").select("id, line_id").eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("id", { ascending: true }).range(lo, hi));
  const out = new Map<string, string>();
  if (error) return out;
  for (const r of (data ?? []) as { id: string; line_id: string | null }[]) if (r.line_id) out.set(r.line_id, r.id);
  return out;
}

/** The Lines editor saves by replacing every line (new ids). Point the BOQ rows at the new ids so the link, the order and the prices survive. */
export async function restoreBoqLinks(admin: SupabaseClient, tenantId: string, oppId: string, moves: readonly { boqRowId: string; lineId: string }[]): Promise<void> {
  for (let i = 0; i < moves.length; i += 20) {
    await Promise.all(moves.slice(i, i + 20).map((m) =>
      admin.from("tender_boq_lines").update({ line_id: m.lineId, updated_at: new Date().toISOString() }).eq("id", m.boqRowId).eq("tenant_id", tenantId).eq("opportunity_id", oppId)));
  }
}
