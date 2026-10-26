import type { ComposerLine } from "@/components/rfq/RfqComposer";
import type { EstLine, MissingCost } from "./rules";

// The starting lines of an RFQ raised for an estimate's missing costs (GCC tender deals, slice 3c-1): one RFQ line per estimate line
// that has no unit cost or a cost older than the RFQ price validity. The estimate line travels as `source_line_id` (the server proves it
// is a line of THIS estimate in THIS workspace and remembers it on the RFQ line, so an award can write the cost back). Pure.
// What a supplier sees is only the description, unit and quantity: never the estimate, the deal or the cost we hold.

export function missingReasonText(m: Pick<MissingCost, "reason" | "age_days">): string {
  return m.reason === "no_cost" ? "no cost yet" : `cost ${m.age_days ?? "?"} days old`;
}

export function missingRfqLines(items: readonly { line: EstLine; reason: MissingCost["reason"]; age_days: number | null }[]): ComposerLine[] {
  return items.map(({ line, reason, age_days }) => ({
    source_line_id: line.id,
    product_id: line.product_id,
    description: line.description,
    uom: line.uom,
    qty: Number(line.qty),
    include: true,
    hint: missingReasonText({ reason, age_days }),
  }));
}

export const estimateOriginLabel = (estimateRef: string | null, dealRef: string | null): string =>
  `Estimate ${estimateRef ?? ""}${dealRef ? ` (Tender ${dealRef})` : ""}`.replace(/\s+/g, " ").trim();
