import "server-only";

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
