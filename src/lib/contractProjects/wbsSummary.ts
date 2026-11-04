import { wbsCopyText } from "./fromTender";

// The one line that says what a project's WBS holds ("6 items · 14 lines (2 split) · 2 unassigned"), shared by the page header and the Overview. Pure.

type View = { packages: readonly unknown[]; allocation: { lineRows: readonly { wbs: readonly unknown[] }[]; unassigned: readonly unknown[] } };

export function wbsSummary(v: View): string {
  return wbsCopyText({
    items: v.packages.length,
    lines: v.allocation.lineRows.filter((r) => r.wbs.length > 0).length,
    split: v.allocation.lineRows.filter((r) => r.wbs.length > 1).length,
    unassigned: v.allocation.unassigned.length,
  });
}
