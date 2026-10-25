import { rfqPrefill, type DocLineForRfq } from "@/components/rfq/prefill";
import type { ComposerLine } from "@/components/rfq/RfqComposer";

// The starting lines of an RFQ raised from a tender deal (GCC tender deals, slice 3b): the same prefill every record uses (lines
// still without a price start ticked, lines already on an RFQ are named and unticked), plus the client's own item number carried
// as the line's reference so the supplier's answer can be matched back to the tender's schedule. Pure.

export function tenderRfqLines(lines: DocLineForRfq[], linkedRef: (rfqLineId: string) => string | null): ComposerLine[] {
  const bySource = new Map(lines.map((l) => [l.id, l]));
  return rfqPrefill(lines, linkedRef).map((cl) => {
    const sl = cl.source_line_id ? bySource.get(cl.source_line_id)?.sl_no : null;
    const item = sl === null || sl === undefined || String(sl).trim() === "" ? null : `Item no. ${String(sl).trim()}`;
    if (!item) return cl;
    return { ...cl, spec: cl.spec ? `${item}. ${cl.spec}` : item };
  });
}
