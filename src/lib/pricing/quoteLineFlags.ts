import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LineFlag } from "@/lib/pricing-core";

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

/** Postgres/PostgREST names the offending column in the 42703 message
 *  (`column "group_id" of relation "standard_quote_lines" does not
 *  exist`) -- pull it out so the retry can drop exactly that column
 *  rather than guessing from a hardcoded list. */
function missingColumnName(error: { code?: string; message: string }): string | null {
  if (error.code !== "42703" && !/does not exist/.test(error.message)) return null;
  const m = /column "([a-zA-Z0-9_]+)"/.exec(error.message);
  return m ? m[1] : null;
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

/** The flagged lines of one document, tolerating the pending migration
 *  (a missing column reads as "no flags", never as a crash). */
export async function flaggedLinesOf(
  supabase: SupabaseClient,
  table: "quote_lines" | "standard_quote_lines",
  parentColumn: "quote_id" | "standard_quote_id",
  tenantId: string,
  documentId: string
): Promise<{ sl_no?: string | null; description?: string; pricing_flags?: LineFlag[] | null }[]> {
  const { data, error } = await supabase
    .from(table).select("sl_no, description, pricing_flags")
    .eq(parentColumn, documentId).eq("tenant_id", tenantId).not("pricing_flags", "is", null);
  if (error) return [];
  return (data ?? []) as { sl_no?: string | null; description?: string; pricing_flags?: LineFlag[] | null }[];
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
