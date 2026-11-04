// The explanations the WBS screens keep behind an "i" (bpmsquarecore 6b). Held to the InfoTip limit (two sentences, 160 characters) by
// tree.test.ts next to it. The screens never print these as running text.

export const WBS_TIPS = {
  view: "BOQ shows the client's order. WBS shows the same lines grouped the way you will run the work.",
  group: "Tick lines, then put them in a new or existing WBS item. A line sits in one item.",
  code: "Codes number themselves: 1, 1.1, 1.1.1. Type a code to use your ERP's; Renumber recomputes the rest.",
  rollup: "An item's figures are its own lines plus its sub-items. Nothing is counted twice.",
  ownerBid: "Optional while bidding. On the project every item needs an owner with a login.",
  ownerProject: "The employee who runs this part of the work. Only an employee with a login can own an item.",
  locked: "After the baseline is approved the money is fixed. Names, codes, parents and owners can still change.",
  unassigned: "Lines not in any WBS item, and the unassigned remainder of a split line. A revised BOQ puts new lines here.",
  revised: "A revised file keeps your grouping: lines are matched by item number. Lines no longer in the file are flagged.",
  split: "Share one line across WBS items by percent; the quantities follow. Shares must add up to 100 %.",
  splitQty: "Shares are kept as percent, so a revised quantity re-derives the quantities and keeps your split.",
  rfqWhole: "A supplier prices the whole BOQ line, whatever its WBS split.",
  parent: "Optional. An item can sit under another, up to three levels deep.",
  buyout: "Starts a buy-out package from this item's lines. A split line goes in whole; lines already in a package are left unticked.",
  fromTender:"This item was copied from the tender when the project was created. The project keeps its own copy from then on.",
} as const;

export type WbsTipKey = keyof typeof WBS_TIPS;

/** Shown in place of the WBS when migration 0243 has not been applied yet. */
export const WBS_PENDING = "WBS needs a database update (migration 0243)";
