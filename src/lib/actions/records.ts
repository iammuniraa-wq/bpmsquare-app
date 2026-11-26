import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/assistant/objects";
import { promptText } from "@/lib/assistant/promptSafe";

// Finds the ONE record a person means by a business reference (OPP-0034, SUP-0003), a SKU, a tender number or an exact name,
// inside one workspace. The assistant never guesses: an exact match is a record, several are a question, and a name that only
// contains the words is a question too, with the closest candidates. Every query carries the tenant filter, and an id the
// person (or the model) names is read back through that same filter, so another workspace's id is simply "not found".

export type Row = Record<string, unknown>;
export type RecordHit = { id: string; label: string };

export type Resolved =
  | { kind: "one"; id: string; row: Row }
  | { kind: "many"; hits: RecordHit[]; exact: boolean }
  | { kind: "none" };

export type RecordTarget = {
  table: string;
  nameColumn: "name" | "title";
  /** Only deals that carry a tender row (and a match on the tender number too). */
  tenderOnly?: boolean;
  /** A second identifier a person says: a product's SKU. */
  extraRef?: "sku";
};

const REF_RE = /^[A-Za-z]{2,4}-\d{3,}$/;
const LIMIT = 6;
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

const labelOf = (t: RecordTarget, r: Row): string => {
  const name = str(r[t.nameColumn]);
  const ref = str(r.ref);
  return ref && name ? `${ref} · ${name}` : name || ref || "Unnamed";
};

type Mode = "eq" | "exact" | "contains";

async function byColumn(supabase: SupabaseClient, tenantId: string, t: RecordTarget, col: string, mode: Mode, value: string): Promise<Row[]> {
  const q = supabase.from(t.table).select("*").eq("tenant_id", tenantId);
  const filtered = mode === "eq" ? q.eq(col, value) : q.ilike(col, mode === "exact" ? escapeLike(value) : `%${escapeLike(value)}%`);
  const { data } = await filtered.limit(LIMIT + 1);
  return (data ?? []) as Row[];
}

async function tenderRows(supabase: SupabaseClient, tenantId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from("opportunity_tenders").select("opportunity_id").eq("tenant_id", tenantId).in("opportunity_id", ids);
  return new Set(((data ?? []) as { opportunity_id: string }[]).map((r) => r.opportunity_id));
}

/** Deals whose tender number is (or contains) the words. */
async function byTenderNo(supabase: SupabaseClient, tenantId: string, t: RecordTarget, mode: "exact" | "contains", value: string): Promise<Row[]> {
  const { data } = await supabase.from("opportunity_tenders").select("opportunity_id")
    .eq("tenant_id", tenantId).ilike("tender_no", mode === "exact" ? escapeLike(value) : `%${escapeLike(value)}%`).limit(LIMIT + 1);
  const ids = ((data ?? []) as { opportunity_id: string }[]).map((r) => r.opportunity_id);
  if (ids.length === 0) return [];
  const { data: deals } = await supabase.from(t.table).select("*").eq("tenant_id", tenantId).in("id", ids);
  return (deals ?? []) as Row[];
}

async function keepTenders(supabase: SupabaseClient, tenantId: string, t: RecordTarget, rows: Row[]): Promise<Row[]> {
  if (!t.tenderOnly || rows.length === 0) return rows;
  const ok = await tenderRows(supabase, tenantId, rows.map((r) => str(r.id)));
  return rows.filter((r) => ok.has(str(r.id)));
}

async function loadOne(supabase: SupabaseClient, tenantId: string, t: RecordTarget, id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from(t.table).select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!data) return null;
  if (t.tenderOnly && !(await tenderRows(supabase, tenantId, [id])).has(id)) return null;
  return data as Row;
}

/** One record of this workspace by id, or null: the check every id from a request or a signed card goes through. */
export const loadRecordRow = loadOne;

const uniqueById = (rows: Row[]): Row[] => {
  const seen = new Set<string>();
  return rows.filter((r) => { const id = str(r.id); if (!id || seen.has(id)) return false; seen.add(id); return true; });
};

export async function resolveRecord(
  supabase: SupabaseClient, tenantId: string, t: RecordTarget, hint: string | undefined, pageRecordId?: string | null,
): Promise<Resolved> {
  const needle = (hint ?? "").trim().slice(0, 120);
  if (!needle) {
    const row = pageRecordId ? await loadOne(supabase, tenantId, t, pageRecordId) : null;
    return row ? { kind: "one", id: str(row.id), row } : { kind: "none" };
  }
  if (isUuid(needle as unknown)) {
    const row = await loadOne(supabase, tenantId, t, needle);
    return row ? { kind: "one", id: str(row.id), row } : { kind: "none" };
  }

  let rows: Row[] = [];
  if (REF_RE.test(needle)) rows = await byColumn(supabase, tenantId, t, "ref", "eq", needle.toUpperCase());
  if (rows.length === 0 && t.extraRef) rows = await byColumn(supabase, tenantId, t, t.extraRef, "exact", needle);
  if (rows.length === 0 && t.tenderOnly) rows = await byTenderNo(supabase, tenantId, t, "exact", needle);
  if (rows.length === 0) rows = await byColumn(supabase, tenantId, t, t.nameColumn, "exact", needle);
  rows = uniqueById(await keepTenders(supabase, tenantId, t, rows));

  if (rows.length === 1) {
    const row = await loadOne(supabase, tenantId, t, str(rows[0].id));
    return row ? { kind: "one", id: str(row.id), row } : { kind: "none" };
  }
  if (rows.length > 1) return { kind: "many", exact: true, hits: rows.slice(0, LIMIT).map((r) => ({ id: str(r.id), label: labelOf(t, r) })) };

  let near = await byColumn(supabase, tenantId, t, t.nameColumn, "contains", needle);
  if (t.tenderOnly) near = [...near, ...(await byTenderNo(supabase, tenantId, t, "contains", needle))];
  near = uniqueById(await keepTenders(supabase, tenantId, t, near));
  return near.length > 0
    ? { kind: "many", exact: false, hits: near.slice(0, LIMIT).map((r) => ({ id: str(r.id), label: labelOf(t, r) })) }
    : { kind: "none" };
}

/** The sentence the model is given when the record is not one: it asks the person, and no card is shown. */
export function notOneMessage(noun: string, hint: string | undefined, r: Exclude<Resolved, { kind: "one" }>): string {
  const said = (hint ?? "").trim();
  if (r.kind === "none") {
    return said
      ? `No ${noun} matched "${said.slice(0, 80)}" in this workspace. Tell the person and ask which ${noun} they mean; no card has been shown.`
      : `Which ${noun} is this about? Ask the person; no card has been shown.`;
  }
  const list = r.hits.map((h) => promptText(h.label, 80)).join("; ");
  return r.exact
    ? `Several ${noun}s are called "${said.slice(0, 80)}": ${list}. Ask which one (they can give the reference); no card has been shown.`
    : `No ${noun} is called exactly "${said.slice(0, 80)}". Closest: ${list}. Ask the person which one they mean, then call again with its reference; no card has been shown.`;
}
