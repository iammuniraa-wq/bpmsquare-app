import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Derives the next sequence number from existing refs by taking the HIGHEST
 * matching sequence + 1, rather than counting rows. count+1 breaks permanently
 * as soon as any record is deleted: with refs 0001..0005 and one deleted, the
 * count is 4, so the "next" ref is 0005 -- which still exists, and every
 * recompute yields the same unique-constraint collision (this was the
 * "quotes_tenant_ref_uniq" violation reported on quote save; the same shape
 * existed for invoices, purchase orders, cases and quote-copy).
 *
 * `pattern` must have exactly one capture group over the numeric sequence.
 */
export function nextSeqFromRefs(refs: (string | null | undefined)[], pattern: RegExp): number {
  let max = 0;
  for (const ref of refs) {
    if (!ref) continue;
    const m = pattern.exec(ref);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

/**
 * Walks forward from `startSeq` until a ref that doesn't exist yet for this
 * tenant is found, and returns it. Belt-and-braces on top of nextSeqFromRefs:
 * the max-derived candidate can still collide when (a) the tenant has more
 * rows than one select returns, or (b) refs from an older/changed ID format
 * hold numbers the current format's pattern didn't match. A cheap indexed
 * existence probe per step makes the generator converge on a free ref
 * regardless -- the DB unique constraint remains the final race arbiter.
 * Bails out if the formatter ignores the sequence (a template with no {SEQ}
 * renders the same ref forever -- probing can't disambiguate that).
 */
export async function firstFreeRef(
  supabase: SupabaseClient,
  table: string,
  tenantId: string,
  makeRef: (seq: number) => string,
  startSeq: number,
  maxProbes = 200,
  /** Column holding the business id. Defaults to the master-data convention;
   * employees carry theirs in `employee_code` instead. */
  column = "ref",
  /** Case-insensitive existence probe (ilike with no wildcards). Needed when
   * the backing unique index is on lower(column) and legacy rows may carry
   * mixed-case values the generator itself would never emit. */
  caseInsensitive = false
): Promise<string> {
  let seq = startSeq;
  let ref = makeRef(seq);
  for (let i = 0; i < maxProbes; i++) {
    const base = supabase.from(table).select("id").eq("tenant_id", tenantId);
    const probe = caseInsensitive ? base.ilike(column, ref) : base.eq(column, ref);
    const { data } = await probe.limit(1);
    if (!data || data.length === 0) return ref;
    const next = makeRef(++seq);
    if (next === ref) break;
    ref = next;
  }
  return ref;
}
