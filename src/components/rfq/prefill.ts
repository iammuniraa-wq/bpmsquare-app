import type { ComposerLine } from "./RfqComposer";

// Turn a document's own lines (quote, standard quote, deal) into the RFQ
// form's starting lines. Pure, shared by every detail page.
//
// Which lines start ticked: the ones still without a price and not already
// on an RFQ. When every line is priced, all unlinked lines start ticked
// instead -- pressing "Request quotation" on a priced quote means "check
// these prices with suppliers". Lines already on an RFQ start unticked,
// named, so nobody asks twice by accident. Quantity-break rows and
// alternatives the customer wasn't offered are left out: they repeat an item
// that is already listed.

export type DocLineForRfq = {
  id: string;
  description: string;
  uom: string | null;
  qty: number | string | null;
  rate: number | string | null;
  product_id?: string | null;
  rfq_line_id?: string | null;
  break_of?: string | null;
  sl_no?: string | number | null;
};

export function rfqPrefill(lines: DocLineForRfq[], linkedRef: (rfqLineId: string) => string | null): ComposerLine[] {
  const usable = lines.filter((l) => !l.break_of && (l.description ?? "").trim());
  const unpriced = (l: DocLineForRfq) => !(Number(l.rate) > 0);
  const anyUnpriced = usable.some((l) => !l.rfq_line_id && unpriced(l));
  return usable.map((l) => {
    const linked = l.rfq_line_id ? linkedRef(l.rfq_line_id) ?? "another RFQ" : null;
    return {
      source_line_id: l.id,
      product_id: l.product_id ?? null,
      description: l.description,
      uom: l.uom,
      qty: l.qty,
      include: !linked && (!anyUnpriced || unpriced(l)),
      linked_ref: linked,
      hint: unpriced(l) ? "no price yet" : null,
    };
  });
}
