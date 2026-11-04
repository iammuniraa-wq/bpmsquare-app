import { isDescendant, partsOf, SHARE_TOLERANCE } from "@/lib/wbs/tree";
import { asTreeItem, lineMemberships } from "./allocation";
import type { BudgetLine, WorkPackageRow } from "./types";

// "Make buy-out package" on a WBS item (docs/design/wbs.md section 4): what the New package panel starts with. PURE.
//
// A buy-out package holds whole budget lines of the APPROVED budget, by line id, and a supplier prices the whole line: so a line split across
// WBS items goes in whole (with the share this item holds shown beside it), and a line already in another package is left unticked with the
// package named. The item's lines are found by `line_key`, which is stable across revisions, in the approved budget's lines the buy-out summary
// lists as still free.

/** The slice of the buy-out summary this reads (BuyoutData satisfies it). */
export type BuyoutLines = {
  unassigned_lines: { id: string; line_key?: string }[];
  packaged_lines?: Record<string, { ref: string | null; name: string }>;
};

export type TakenLine = { line_key: string; label: string; package_ref: string | null; package_name: string };

export type BuyoutPrefill = {
  name: string;
  /** The approved budget line ids to tick. */
  budget_line_ids: string[];
  /** For a split line: the percent of it that sits in this item (and its sub-items), by approved budget line id. */
  shares: Record<string, number>;
  /** The item's lines that are already in a package: shown unticked, with the package. */
  taken: TakenLine[];
  /** Lines the item holds that cannot be packaged: not in the approved budget, or reserve. */
  skipped: number;
};

const label = (l: Pick<BudgetLine, "wbs" | "line_no" | "description">) => `${l.wbs ?? `#${l.line_no}`} ${l.description}`.trim();

export function wbsBuyoutPrefill(item: Pick<WorkPackageRow, "id" | "name" | "code">, packages: readonly WorkPackageRow[], lines: readonly BudgetLine[], buyout: BuyoutLines): BuyoutPrefill {
  const items = packages.map(asTreeItem);
  const inItem = new Set([item.id, ...items.filter((i) => isDescendant(items, item.id, i.id)).map((i) => i.id)]);
  const freeByKey = new Map(buyout.unassigned_lines.filter((l) => l.line_key).map((l) => [l.line_key as string, l.id]));
  const memberships = lineMemberships(packages);

  const out: BuyoutPrefill = { name: item.name, budget_line_ids: [], shares: {}, taken: [], skipped: 0 };
  const sorted = [...lines].sort((a, b) => a.line_no - b.line_no);
  for (const l of sorted) {
    const m = memberships.get(l.line_key);
    if (!m) continue;
    const here = partsOf(m).filter((p) => inItem.has(p.wbs_item_id)).reduce((s, p) => s + p.share_pct, 0);
    if (here <= 0) continue;
    const id = freeByKey.get(l.line_key);
    if (id) {
      out.budget_line_ids.push(id);
      if (here < 100 - SHARE_TOLERANCE) out.shares[id] = Math.round(here * 10000) / 10000;
      continue;
    }
    const taken = buyout.packaged_lines?.[l.line_key];
    if (taken) out.taken.push({ line_key: l.line_key, label: label(l), package_ref: taken.ref, package_name: taken.name });
    else out.skipped += 1;
  }
  return out;
}
