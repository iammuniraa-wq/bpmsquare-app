// The tabs of a tender deal and where an old link lands (redesign, docs/design/gcc-tender-deals.md section 26). PURE.
//
// Overview | Bill of quantities | Costing | Bid | Room | Competitors, in that order, and nothing else. History is not a tab: it is a
// panel opened from the header "..." menu. The Quotes, Related, Estimates, Lines and Activity tabs are gone; a bookmark or a saved
// state that still names one lands on the nearest place instead of breaking.

export type TenderTabId = "overview" | "boq" | "costing" | "bid" | "room" | "competitors";
export const TENDER_TAB_ORDER: readonly TenderTabId[] = ["overview", "boq", "costing", "bid", "room", "competitors"];

const OLD: Record<string, { tab: TenderTabId; history?: boolean }> = {
  tender: { tab: "overview" },
  lines: { tab: "boq" },
  estimates: { tab: "costing" },
  related: { tab: "costing" },
  bids: { tab: "bid" },
  quotes: { tab: "bid" },
  activity: { tab: "overview", history: true },
  history: { tab: "overview", history: true },
};

/** Where `raw` (a ?tab= value or a remembered tab) lands, given the tabs this deal has. A tab the deal does not have falls back to the nearest one. */
export function resolveTenderTab(raw: string | null | undefined, available: readonly TenderTabId[]): { tab: TenderTabId; history: boolean } {
  const has = (t: TenderTabId) => available.includes(t);
  const key = (raw ?? "").trim();
  let want: TenderTabId = "overview";
  let history = false;
  if ((TENDER_TAB_ORDER as readonly string[]).includes(key)) want = key as TenderTabId;
  else if (OLD[key]) { want = OLD[key].tab; history = !!OLD[key].history; }
  if (has(want)) return { tab: want, history };
  return { tab: want === "costing" && has("boq") ? "boq" : "overview", history };
}
