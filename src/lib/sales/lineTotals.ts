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
// Quantity breaks (§3.4) always use `is_selected` on the break rows
// themselves, regardless of which object it is, because a break has no
// natural header slot to live in.

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
  const withSelection = altGroupIds.find((gid) => lines.some((l) => l.group_id === gid && l.is_selected === true));
  return withSelection ?? altGroupIds[0];
}

/** For each break family (a base line plus every row whose `break_of`
 *  points at it), which ONE row's quantity is the chosen one. Keyed by the
 *  base line's id; the value is the id of the row that counts (the base
 *  line itself, or one of its break rows). Families with no break rows at
 *  all are not included. */
function chosenBreakRowId<T extends SelectableLine>(lines: T[]): Map<string, string> {
  const byParent = new Map<string, T[]>();
  for (const l of lines) {
    if (!l.break_of) continue;
    const rows = byParent.get(l.break_of);
    if (rows) rows.push(l); else byParent.set(l.break_of, [l]);
  }
  const chosen = new Map<string, string>();
  for (const [parentId, rows] of byParent) {
    const explicit = rows.find((l) => l.is_selected === true);
    chosen.set(parentId, explicit ? explicit.id : parentId); // default: the base line
  }
  return chosen;
}

/**
 * The subset of `lines` that count toward the document total: only the
 * chosen alternative group's lines, and for a line with quantity breaks,
 * only the chosen quantity.
 */
export function selectedLines<T extends SelectableLine>(
  lines: T[],
  opts: { selectedOptionId?: string | null } = {}
): T[] {
  const chosenGroup = chosenAltGroupId(lines, opts);
  const chosenBreak = chosenBreakRowId(lines);

  return lines.filter((l) => {
    if (l.group_type === "alternative" && l.group_id && l.group_id !== chosenGroup) return false;
    if (l.break_of) return chosenBreak.get(l.break_of) === l.id;
    if (chosenBreak.has(l.id)) return chosenBreak.get(l.id) === l.id; // this line IS a break family's base
    // An ordinary line (no group, no break involvement) opts out only when
    // explicitly deselected; absent/undefined counts, matching the DB default.
    return l.is_selected !== false;
  });
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
  const chosenBreak = chosenBreakRowId(lines);

  return lines.map((l) => {
    // A line inside an alternative option can carry quantity breaks too
    // (0118 add-line panel), so both conditions apply: the option must be
    // chosen AND, within its break family, this must be the chosen row.
    const groupOk = l.group_type === "alternative" && l.group_id ? l.group_id === chosenGroup : true;
    if (l.break_of) {
      return { ...l, is_selected: groupOk && chosenBreak.get(l.break_of) === l.id };
    }
    if (chosenBreak.has(l.id)) {
      return { ...l, is_selected: groupOk && chosenBreak.get(l.id) === l.id };
    }
    if (l.group_type === "alternative" && l.group_id) {
      return { ...l, is_selected: groupOk };
    }
    return l;
  });
}
