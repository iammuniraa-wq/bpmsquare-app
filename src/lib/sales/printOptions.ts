// What a Standard Quote's PDF prints for the options the customer did not
// choose (0118, docs/sales-engine-architecture.md §3.6). Presentation only:
// nothing here changes which lines count toward the total -- that is
// lineTotals.ts's job and it never reads these.

import { selectedLines, type SelectableLine } from "./lineTotals";

export type PrintOptions = {
  /** Alternative option groups: print every option (the unchosen ones
   *  greyed out) or only the chosen one. */
  alternatives: "all" | "chosen";
  /** Quantity breaks: print every quantity (unchosen greyed out) or only
   *  the chosen quantity. */
  breaks: "all" | "chosen";
};

export const DEFAULT_PRINT_OPTIONS: PrintOptions = { alternatives: "all", breaks: "all" };

/** A stored/submitted value -> a complete PrintOptions, defaults for
 *  anything missing or malformed (never throws: a bad value prints the
 *  way the document always did). */
export function parsePrintOptions(raw: unknown): PrintOptions {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    alternatives: o.alternatives === "chosen" ? "chosen" : "all",
    breaks: o.breaks === "chosen" ? "chosen" : "all",
  };
}

/** True when the stored value is exactly the default, so the write side
 *  can store null instead of a redundant object. */
export function isDefaultPrintOptions(o: PrintOptions): boolean {
  return o.alternatives === "all" && o.breaks === "all";
}

export type PdfLine = SelectableLine & { show_on_pdf?: boolean | null };

/**
 * The lines the PDF prints, in order: a line the rep hid (`show_on_pdf
 * false`) never prints; an unchosen alternative or an unchosen quantity
 * prints only when the document says "all". A row that prints is not
 * necessarily charged (the greyed-out unchosen ones), and a row that is
 * charged can be hidden -- the two are independent by design.
 */
export function linesForPdf<T extends PdfLine>(lines: T[], options: PrintOptions, opts: { selectedOptionId?: string | null } = {}): T[] {
  // The two decisions are independent: which OPTION is chosen (a group
  // question) and, within each break family, which QUANTITY is chosen (a
  // row question, answered the same way whether or not its option is the
  // chosen one -- an unchosen option still has a "would-be" quantity).
  const chosenGroups = new Set(
    selectedLines(lines, opts).filter((l) => l.group_type === "alternative" && l.group_id).map((l) => l.group_id as string)
  );
  const familyChosen = new Map<string, string>();
  for (const l of lines) {
    if (!l.break_of) continue;
    if (!familyChosen.has(l.break_of)) familyChosen.set(l.break_of, l.break_of);
    if (l.is_selected === true) familyChosen.set(l.break_of, l.id);
  }
  return lines.filter((l) => {
    if (l.show_on_pdf === false) return false;
    const inGroup = l.group_type === "alternative" && !!l.group_id;
    if (inGroup && !chosenGroups.has(l.group_id as string) && options.alternatives !== "all") return false;
    const familyId = l.break_of || (familyChosen.has(l.id) ? l.id : null);
    if (familyId && familyChosen.get(familyId) !== l.id && options.breaks !== "all") return false;
    if (!inGroup && !familyId && l.is_selected === false) return false; // an ordinary line explicitly deselected
    return true;
  });
}
