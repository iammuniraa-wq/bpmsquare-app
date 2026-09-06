// Sales Engine, Piece A (docs/sales-engine-architecture.md §3.1, §3.3, §3.4):
// the ONE way to decide which lines of a document count toward its total.
// Pure, no I/O -- used server-side (both quote objects, later the
// opportunity) to compute the stored total, and client-side to mirror it
// for display. Two selection mechanisms exist in this codebase and both are
// handled here:
//
//   - Quotations: the CHOSEN alternative is a header column
//     (`quotes.selected_option_id`), not a per-line flag -- pass it as
//     `selectedOptionId`.
//   - Standard Quotes (and the opportunity): the chosen alternative is
//     `is_selected` on the group's own lines -- leave `selectedOptionId`
//     unset and this reads `is_selected` instead.
//
// Quantity breaks (§3.4, revised 2026-09-06): a break row never counts --
// it is an offer of another quantity, printed on the quote -- and its own
// `is_selected` means "offered" (printed), regardless of which object it is.

export type SelectableLine = {
  id: string;
  amount: number;
  group_id?: string | null;
  group_type?: string | null; // "additive" | "alternative"
  break_of?: string | null;
  /** Not read by this module (display/print only) but part of the shared
   *  contract -- kept here so callers can pass a real line row as-is. */
  break_qty?: number | null;
  is_selected?: boolean | null;
};

/** Among every distinct `group_id` with `group_type "alternative"`, which
 *  ONE is the chosen option. Multiple lines can share a group_id (an option
 *  worth several line items); the decision is about the group, never about
 *  individual lines within it. */
function chosenAltGroupId<T extends SelectableLine>(lines: T[], opts: { selectedOptionId?: string | null }): string | null {
  const altGroupIds = [...new Set(lines.filter((l) => l.group_type === "alternative" && l.group_id).map((l) => l.group_id as string))];
  if (altGroupIds.length === 0) return null;

  if (opts.selectedOptionId !== undefined) {
    // Quotations convention: the header decides; a stale/unknown id falls
    // back to the first group rather than pricing nothing.
    return altGroupIds.includes(opts.selectedOptionId ?? "") ? (opts.selectedOptionId as string) : altGroupIds[0];
  }
  // Standard Quotes / opportunity convention: whichever group has a line
  // EXPLICITLY marked selected (is_selected === true -- not merely "not
  // false", or every untouched line in every group would look chosen).
  // A break row's flag means "offered", not "this option is chosen" -- so
  // only the option's own (non-break) lines vote.
  const withSelection = altGroupIds.find((gid) => lines.some((l) => l.group_id === gid && !l.break_of && l.is_selected === true));
  return withSelection ?? altGroupIds[0];
}

/** The ids of every line that has quantity breaks under it. */
function breakFamilyBases<T extends SelectableLine>(lines: T[]): Set<string> {
  return new Set(lines.filter((l) => l.break_of).map((l) => l.break_of as string));
}

/**
 * The subset of `lines` that count toward the document total: only the
 * chosen alternative group's lines, and never a quantity-break row.
 *
 * Quantity breaks (owner decision 2026-09-06, superseding §3.4's "chosen
 * quantity"): reps send several quantities of the same item to upsell, so
 * a break is an OFFER printed on the quote, never what is charged. The
 * base line's quantity is what the document totals; a break row's
 * `is_selected` means "offered on the quote" (printed), not "charged".
 */
export function selectedLines<T extends SelectableLine>(
  lines: T[],
  opts: { selectedOptionId?: string | null } = {}
): T[] {
  const chosenGroup = chosenAltGroupId(lines, opts);
  const bases = breakFamilyBases(lines);

  return lines.filter((l) => {
    if (l.group_type === "alternative" && l.group_id && l.group_id !== chosenGroup) return false;
    if (l.break_of) return false;
    // A line with breaks under it is always the charged quantity (its own
    // flag may still carry the pre-2026-09-06 "chosen break" meaning).
    if (bases.has(l.id)) return true;
    // An ordinary line opts out only when explicitly deselected;
    // absent/undefined counts, matching the DB default.
    return l.is_selected !== false;
  });
}

/** Whether a quantity-break row is offered on the quote (printed). */
export function isOfferedBreak(l: SelectableLine): boolean {
  return !!l.break_of && l.is_selected !== false;
}

export function documentTotal<T extends SelectableLine>(lines: T[], opts: { selectedOptionId?: string | null } = {}): number {
  return selectedLines(lines, opts).reduce((sum, l) => sum + (l.amount || 0), 0);
}

/**
 * Enforces the selection invariants before a write: every line in a
 * non-chosen alternative group becomes `is_selected: false`, the chosen
 * group's lines become `true`; every non-chosen member of a break family
 * becomes `false`, the chosen one `true`. Ordinary lines (no group, no
 * break involvement) are returned unchanged. Called by the line-save
 * routes so `is_selected` in the database is never ambiguous -- the
 * read-side functions above tolerate ambiguity defensively, but should
 * never need to for data this function has touched.
 */
export function normalizeSelection<T extends SelectableLine>(lines: T[]): T[] {
  const chosenGroup = chosenAltGroupId(lines, {});
  const bases = breakFamilyBases(lines);

  return lines.map((l) => {
    // A break row's flag is "offered on the quote": kept as sent, absent
    // meaning offered. It never depends on the option, since an unchosen
    // option's offers are simply not printed.
    if (l.break_of) return { ...l, is_selected: l.is_selected !== false };
    if (l.group_type === "alternative" && l.group_id) {
      return { ...l, is_selected: l.group_id === chosenGroup };
    }
    // A line with breaks under it is always the charged quantity.
    if (bases.has(l.id)) return { ...l, is_selected: true };
    return l;
  });
}
