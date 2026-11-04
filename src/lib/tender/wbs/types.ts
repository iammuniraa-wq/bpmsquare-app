import type { Figures, Share, TreeItem } from "@/lib/wbs/tree";

// The WBS of a tender deal (migration 0243; docs/design/wbs.md). The tree rules are in src/lib/wbs/tree.ts; this is the tender's shapes.

/** One row of tender_wbs_items as the app reads it. */
export type WbsItemRow = TreeItem & { opportunity_id: string; note: string | null };

/** An item as the screens get it: in tree order, with its depth, its owner's name and whether it is a leaf. */
export type WbsItemView = WbsItemRow & { owner_name: string | null; depth: number; is_leaf: boolean };

/** Where each BOQ line sits (by tender_boq_lines.id): in one item, or split across several. */
export type LineMembers = { item: Map<string, string | null>; parts: Map<string, Share[]> };

export type WbsState = {
  /** Migration 0243 has not been applied: the WBS view and the Split button say so and nothing else changes. */
  pending: boolean;
  items: WbsItemView[];
  rollup: Record<string, Figures>;
  total: Figures;
};

export const EMPTY_WBS: WbsState = {
  pending: false, items: [], rollup: {}, total: { part_count: 0, shared_count: 0, client_amount: 0, cost: null, priced_count: 0, costed_count: 0 },
};

/** The line as a split request names it: an existing item, or a new one made on the spot. */
export type SplitRequestPart = { wbs_item_id?: string; new?: { name: string; parent_id?: string | null }; share_pct: number };
