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
  const chosen = new Set(selectedLines(lines, opts).map((l) => l.id));
  const isBreakBase = new Set(lines.filter((l) => l.break_of).map((l) => l.break_of as string));
  return lines.filter((l) => {
    if (l.show_on_pdf === false) return false;
    if (chosen.has(l.id)) return true;
    if (l.group_type === "alternative" && l.group_id) {
      // An unchosen option's lines -- including any breaks they carry.
      if (options.alternatives === "chosen") return false;
      // Inside an offered option, an unchosen quantity follows the breaks rule.
      if (l.break_of || isBreakBase.has(l.id)) return options.breaks === "all";
      return true;
    }
    if (l.break_of || isBreakBase.has(l.id)) return options.breaks === "all";
    return false; // an ordinary line explicitly deselected
  });
}
