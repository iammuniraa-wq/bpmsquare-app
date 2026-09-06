import "server-only";
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineFlag } from "@/lib/pricing-core";
import { normalizeSelection, selectedLines, type SelectableLine } from "@/lib/sales/lineTotals";

// Quote lines remember the price that produced them (0113). The client
// sends only pricing_document_id; the guardrail flags are derived HERE from
// the stored document, after verifying it belongs to the tenant -- so a rep
// can never strip a "block" by editing the request.

type LineWithPricing = { pricing_document_id?: string | null };

export async function derivePricingFlags(
  supabase: SupabaseClient,
  tenantId: string,
  lines: LineWithPricing[]
): Promise<{ ok: true; flagsByDocument: Map<string, LineFlag[]> } | { ok: false; error: string }> {
  const ids = [...new Set(lines.map((l) => l.pricing_document_id).filter((x): x is string => typeof x === "string" && x.length > 0))];
  const flagsByDocument = new Map<string, LineFlag[]>();
  if (ids.length === 0) return { ok: true, flagsByDocument };
  const { data, error } = await supabase
    .from("pricing_documents").select("id, result").in("id", ids).eq("tenant_id", tenantId);
  // 42P01: 0111 pending -- the ids cannot be verified, so they are dropped
  // rather than trusted (the caller nulls unknown ids).
  if (error) return { ok: true, flagsByDocument };
  for (const row of data ?? []) {
    const result = row.result as { lines?: { flags?: LineFlag[] }[] } | null;
    flagsByDocument.set(row.id as string, result?.lines?.[0]?.flags ?? []);
  }
  return { ok: true, flagsByDocument };
}

/** Attach the verified document id and its flags to each line row; unknown
 *  or foreign ids are dropped, never written. */
export function withPricingColumns<T extends LineWithPricing>(rows: T[], flagsByDocument: Map<string, LineFlag[]>): (T & { pricing_document_id: string | null; pricing_flags: LineFlag[] | null })[] {
  return rows.map((r) => {
    const id = r.pricing_document_id && flagsByDocument.has(r.pricing_document_id) ? r.pricing_document_id : null;
    const flags = id ? flagsByDocument.get(id) ?? [] : null;
    return { ...r, pricing_document_id: id, pricing_flags: flags && flags.length > 0 ? flags : (id ? [] : null) };
  });
}

/** The offending column, in either shape a missing column arrives in
 *  through Supabase: Postgres's own 42703 (`column "x" of relation "y" does
 *  not exist`) or, far more often, PostgREST's schema-cache miss
 *  (`PGRST204: Could not find the 'x' column of 'y' in the schema cache`).
 *  Pulled out so the retry drops exactly that column rather than guessing
 *  from a hardcoded list. */
export function missingColumnName(error: { code?: string; message: string }): string | null {
  if (error.code === "PGRST204" || /schema cache/.test(error.message)) {
    const m = /'([a-zA-Z0-9_]+)' column/.exec(error.message);
    return m ? m[1] : null;
  }
  if (error.code === "42703" || /does not exist/.test(error.message)) {
    const m = /column "([a-zA-Z0-9_]+)"/.exec(error.message);
    return m ? m[1] : null;
  }
  return null;
}

/** Insert document lines, tolerating a database where a pricing or
 *  sales-engine migration (0113/0114 for the pricing columns, 0116 for
 *  the alternative-group and quantity-break columns) is pending: on a
 *  missing-column error the exact offending column is stripped from
 *  every row and the insert retried -- repeatedly, since more than one
 *  migration can be pending at once -- so quoting never breaks because a
 *  migration is late. Capped so a genuinely different error can't loop. */
export async function insertLinesTolerant(
  supabase: SupabaseClient,
  table: "quote_lines" | "standard_quote_lines",
  rows: Record<string, unknown>[]
): Promise<{ error: { message: string } | null; strippedColumns: string[] }> {
  let current = rows;
  const strippedColumns: string[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await supabase.from(table).insert(current);
    if (!error) return { error: null, strippedColumns };
    const column = missingColumnName(error);
    if (!column) return { error, strippedColumns };
    strippedColumns.push(column);
    current = current.map((row) => { const { [column]: _drop, ...rest } = row; return rest; });
  }
  return { error: { message: "Could not save lines — too many pending migrations" }, strippedColumns };
}

export function insertQuoteLinesTolerant(supabase: SupabaseClient, rows: Record<string, unknown>[]) {
  return insertLinesTolerant(supabase, "quote_lines", rows);
}

/** Product ids on incoming lines are foreign ids from the request body:
 *  only those that resolve to this tenant's products survive, the rest are
 *  nulled (MULTI_TENANT_GUARDRAILS.md). */
export async function verifiedProductIds(
  supabase: SupabaseClient,
  tenantId: string,
  lines: { product_id?: string | null }[]
): Promise<Set<string>> {
  const ids = [...new Set(lines.map((l) => l.product_id).filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (ids.length === 0) return new Set();
  const { data } = await supabase.from("products").select("id").in("id", ids).eq("tenant_id", tenantId);
  return new Set((data ?? []).map((r) => r.id as string));
}

/** The flagged lines of one document that actually COUNT -- a flag on an
 *  alternative option the customer isn't offered, or on a quantity break
 *  that isn't the chosen one, must not hold the quote (it isn't being
 *  charged). Selection is resolved by the same lineTotals.ts rules the
 *  total uses; Quotations pass the header's `selected_option_id`. Tolerates
 *  the pending migration (a missing column reads as "no flags", never as a
 *  crash). */
export async function flaggedLinesOf(
  supabase: SupabaseClient,
  table: "quote_lines" | "standard_quote_lines",
  parentColumn: "quote_id" | "standard_quote_id",
  tenantId: string,
  documentId: string,
  opts: { selectedOptionId?: string | null } = {}
): Promise<{ sl_no?: string | null; description?: string; pricing_flags?: LineFlag[] | null }[]> {
  type Row = SelectableLine & { sl_no?: string | null; description?: string; pricing_flags?: LineFlag[] | null };
  const { data, error } = await supabase
    .from(table).select("id, sl_no, description, pricing_flags, amount, group_id, group_type, break_of, is_selected")
    .eq(parentColumn, documentId).eq("tenant_id", tenantId);
  if (error) return [];
  return selectedLines((data ?? []) as Row[], opts).filter((l) => (l.pricing_flags?.length ?? 0) > 0);
}

/**
 * Sales Engine Piece A (sales-engine-architecture.md §3.4). Both quote
 * objects delete every line and re-insert the whole set on every save, so
 * a brand-new quantity break and its parent line are always created in
 * the SAME insert -- neither side can know the parent's real row id
 * before the statement runs. `local_id` is the client's own (arbitrary,
 * request-scoped) working id for a line; `break_of` on a break row names
 * the PARENT's `local_id`, not a real database id. This resolves both to
 * the real ids the server is about to insert with, dropping any
 * `break_of` that doesn't match another line in this exact request --
 * the same "never trust a foreign id from the body" rule
 * MULTI_TENANT_GUARDRAILS.md applies everywhere else, applied here at the
 * tightest possible scope (this one document's own submitted lines).
 * Also runs `normalizeSelection` so `is_selected` is never ambiguous
 * across an alternative group or a break family.
 */
export function resolveLineIdsAndSelection<T extends Omit<SelectableLine, "id"> & { local_id?: string }>(
  lines: T[]
): (Omit<T, "local_id"> & { id: string; break_of: string | null })[] {
  const realId = lines.map(() => randomUUID());
  const idByLocalId = new Map<string, string>();
  lines.forEach((l, i) => { if (l.local_id) idByLocalId.set(l.local_id, realId[i]); });

  const withRealIds = lines.map((l, i) => {
    const { local_id: _drop, ...rest } = l;
    const resolvedBreakOf = l.break_of && idByLocalId.has(l.break_of) ? (idByLocalId.get(l.break_of) as string) : null;
    return { ...rest, id: realId[i], break_of: resolvedBreakOf };
  });

  const selected = normalizeSelection(withRealIds);
  const isSelectedById = new Map(selected.map((s) => [s.id, s.is_selected]));
  return withRealIds.map((l) => ({ ...l, is_selected: isSelectedById.get(l.id) ?? true }));
}

/** The lines that would stop this quote going out: any flag whose policy is
 *  "block" (approvals arrive in batch 3; until then the quote waits). */
export function blockingLines(lines: { sl_no?: string | null; description?: string; pricing_flags?: LineFlag[] | null }[]): { label: string; flag: LineFlag }[] {
  const out: { label: string; flag: LineFlag }[] = [];
  for (const l of lines) {
    for (const f of l.pricing_flags ?? []) {
      if (f.policy === "block") out.push({ label: `${l.sl_no ? `${l.sl_no} ` : ""}${(l.description ?? "").slice(0, 60)}`, flag: f });
    }
  }
  return out;
}
