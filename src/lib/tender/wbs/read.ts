import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/pagedRead";
import { isMissingSchema } from "@/lib/tender/server";
import { employeeNames } from "@/lib/contractProjects/workPackagesServer";
import type { Share } from "@/lib/wbs/tree";
import type { LineMembers, WbsItemRow } from "./types";

// Reads of the tender WBS (migration 0243). Every query is tenant-scoped on the service-role client and tolerates the migration being
// pending: a missing table or column reads as `pending` with nothing in it, never as a crash. The writes are in server.ts.

const ITEM_COLS = "id, opportunity_id, parent_id, code, name, owner_employee_id, sort_order, code_is_manual, note, created_at";

type Raw = Record<string, unknown>;
const toItem = (r: Raw): WbsItemRow => ({
  id: String(r.id), opportunity_id: String(r.opportunity_id), parent_id: (r.parent_id as string | null) ?? null, code: String(r.code), name: String(r.name),
  owner_employee_id: (r.owner_employee_id as string | null) ?? null, sort_order: Number(r.sort_order ?? 0), code_is_manual: r.code_is_manual === true,
  note: (r.note as string | null) ?? null, created_at: typeof r.created_at === "string" ? r.created_at : null,
});

export async function loadItems(admin: SupabaseClient, tenantId: string, oppId: string): Promise<{ items: WbsItemRow[]; pending: boolean }> {
  const res = await readAllPages((lo, hi) => admin.from("tender_wbs_items").select(ITEM_COLS).eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("sort_order", { ascending: true }).order("id", { ascending: true }).range(lo, hi));
  if (res.error) return { items: [], pending: isMissingSchema(res.error) };
  return { items: ((res.data ?? []) as Raw[]).map(toItem), pending: false };
}

/** Which item each BOQ line sits in, and the parts of the split ones. `pending` when either table or the column is not there yet. */
export async function loadMembers(admin: SupabaseClient, tenantId: string, oppId: string): Promise<{ members: LineMembers; pending: boolean }> {
  const members: LineMembers = { item: new Map(), parts: new Map() };
  const lines = await readAllPages((lo, hi) => admin.from("tender_boq_lines").select("id, wbs_item_id").eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("id", { ascending: true }).range(lo, hi));
  if (lines.error) return { members, pending: isMissingSchema(lines.error) };
  for (const l of (lines.data ?? []) as { id: string; wbs_item_id: string | null }[]) members.item.set(l.id, l.wbs_item_id ?? null);
  const parts = await readAllPages((lo, hi) => admin.from("tender_wbs_line_parts").select("boq_line_id, wbs_item_id, share_pct, sort_order").eq("tenant_id", tenantId).eq("opportunity_id", oppId).order("sort_order", { ascending: true }).order("id", { ascending: true }).range(lo, hi));
  if (parts.error) return { members, pending: isMissingSchema(parts.error) };
  for (const p of (parts.data ?? []) as { boq_line_id: string; wbs_item_id: string; share_pct: number | string }[]) {
    members.parts.set(p.boq_line_id, [...(members.parts.get(p.boq_line_id) ?? []), { wbs_item_id: p.wbs_item_id, share_pct: Number(p.share_pct) } satisfies Share]);
  }
  return { members, pending: false };
}

/** The items and where every line sits, in one read; `pending` when migration 0243 is not applied (then nothing is in it). */
export async function loadStructure(admin: SupabaseClient, tenantId: string, oppId: string): Promise<{ items: WbsItemRow[]; members: LineMembers; pending: boolean }> {
  const [it, mem] = await Promise.all([loadItems(admin, tenantId, oppId), loadMembers(admin, tenantId, oppId)]);
  if (it.pending || mem.pending) return { items: [], members: { item: new Map(), parts: new Map() }, pending: true };
  return { items: it.items, members: mem.members, pending: false };
}

export const ownerNames =(admin: SupabaseClient, tenantId: string, items: readonly WbsItemRow[]) => employeeNames(admin, tenantId, items.map((i) => i.owner_employee_id));
