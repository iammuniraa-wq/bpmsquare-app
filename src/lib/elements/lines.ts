import type { BudgetLine, DraftLine } from "@/lib/contractProjects/types";

// How the element fields of a budget line (type, code, client quantity, model quantity: migration 0253) travel with the line when the
// lines of a revision are copied or saved again. Pure. The element panel and the model comparison are the only writers of these fields; the
// budget grid, "Fill from estimate costs" and a revision copy only carry them, so a save from the grid can never erase a code.

export type ElementCarry = Pick<DraftLine, "element_type" | "element_code" | "client_qty" | "model_qty">;

/** The element fields of a stored line, ready to put on its draft copy. */
export const elementCarryOf = (l: Pick<BudgetLine, "element_type" | "element_code" | "client_qty" | "model_qty">): ElementCarry => ({
  element_type: l.element_type ?? null, element_code: l.element_code ?? null, client_qty: l.client_qty ?? null, model_qty: l.model_qty ?? null,
});

/**
 * A budget save from the grid: the lines come back without the element fields (the grid does not edit them), so each takes what the stored line
 * with the same line_key has. A line with no key is new and has none. What the body said about these fields is ignored on purpose.
 */
export function carryElements(lines: readonly DraftLine[], before: readonly Pick<BudgetLine, "line_key" | "element_type" | "element_code" | "client_qty" | "model_qty">[]): DraftLine[] {
  const byKey = new Map(before.map((l) => [l.line_key, l]));
  return lines.map((l) => {
    const old = l.line_key ? byKey.get(l.line_key) : undefined;
    return { ...l, ...(old ? elementCarryOf(old) : { element_type: null, element_code: null, client_qty: null, model_qty: null }) };
  });
}
