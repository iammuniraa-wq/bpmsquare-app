// What the Tender desk home screen is given. Built on the server by `getTenderDeskData` (src/lib/tenderDesk/server.ts), serialised to the
// client, drawn by both styles (Bold tiles, Control room). Client-safe: types only. Contract written 2026-10-27 so the data layer and the
// two screens can be built apart; change it in docs/design/tender-desk.md first.
//
// Money is in the workspace currency as plain numbers (not millions); the screens format it. Dates are ISO strings. Every list is already
// ordered and cut to the size the screens draw, so the client never sorts or slices.

export type TenderDeskStyle = "bold" | "control" | "classic";

export type TenderDeskKpis = {
  /** Sum of the amount of every open tender. */
  openValue: number;
  openCount: number;
  /** Sum of amount x probability / 100 over the open tenders. */
  weightedValue: number;
  /** Open tenders whose bid end date is today or within the next 14 days. */
  closingSoonCount: number;
  closingSoonValue: number;
  /** won / (won + lost) over the last 12 months, 0..1; null when nothing was decided. */
  winRate: number | null;
  won12: number;
  lost12: number;
  /** Awarded buy-out packages across the workspace's contract projects, and the budget of every package. Null budget: no packages yet. */
  buyoutCommitted: number;
  buyoutBudget: number | null;
};

export type TenderDeskStage = {
  /** The stage value of the tenant's tender pipeline (e.g. "estimating"). */
  stage: string;
  label: string;
  /** Stage colour from the tenant's tender stage definitions (OpportunityStageDef.color). */
  color: string;
  count: number;
  value: number;
};

export type TenderDeskClosing = {
  id: string;
  ref: string | null;
  title: string;
  client: string | null;
  closesAt: string;
  /** Whole days from today (workspace time zone) to the bid end date; 0 = today. Never negative: closed bids are not listed. */
  daysLeft: number;
  value: number;
  /** Where the click goes: the deal's own page. */
  href: string;
};

export type TenderDeskMonth = {
  /** "2026-10". */
  key: string;
  /** "Oct". */
  label: string;
  won: number;
  lost: number;
};

export type TenderDeskClient = {
  accountId: string | null;
  name: string;
  value: number;
  count: number;
};

export type TenderDeskTrendPoint = {
  /** End of the week, ISO date. */
  weekEnd: string;
  /** Value of the tenders that were open at that moment, rebuilt from their created and closed dates. */
  openValue: number;
};

export type TenderDeskBuyoutPackage = {
  name: string;
  budget: number;
  bestQuote: number | null;
  committed: number | null;
  /** "awarded" when committed is set, "quotes in" when a quote exists, else "waiting". */
  status: "awarded" | "quotes in" | "waiting";
};

export type TenderDeskBuyout = {
  projectId: string;
  projectName: string;
  href: string;
  packages: TenderDeskBuyoutPackage[];
} | null;

export type TenderDeskAttention = {
  kind: "decision" | "supplier_reply" | "bond_expiry" | "stale_price" | "closing_unpriced";
  title: string;
  sub: string;
  /** Short verb for the button: "Decide", "Remind", "Extend", "Review", "Price". */
  action: string;
  href: string;
  severity: "high" | "medium" | "low";
};

export type TenderDeskData = {
  currency: string;
  /** ISO time the data was read. */
  asOf: string;
  /** A table the desk reads is missing (migration not applied): the screens show a calm empty state instead of numbers. */
  pending: boolean;
  kpis: TenderDeskKpis;
  /** Open stages only, in the tenant's stage order. */
  stages: TenderDeskStage[];
  /** Open tenders that have not reached their bid end date, soonest first, at most 8. */
  closing: TenderDeskClosing[];
  /** The last 12 calendar months ending with the current one, oldest first. */
  months: TenderDeskMonth[];
  /** Open value by client: the top 5, then one "Others" row when there are more. */
  clients: TenderDeskClient[];
  /** 12 weekly points, oldest first; empty when the dates needed are missing. */
  trend: TenderDeskTrendPoint[];
  buyout: TenderDeskBuyout;
  /** Things that need the person: at most 5, most severe first. */
  attention: TenderDeskAttention[];
};

export const EMPTY_TENDER_DESK: TenderDeskData = {
  currency: "SAR",
  asOf: new Date(0).toISOString(),
  pending: false,
  kpis: { openValue: 0, openCount: 0, weightedValue: 0, closingSoonCount: 0, closingSoonValue: 0, winRate: null, won12: 0, lost12: 0, buyoutCommitted: 0, buyoutBudget: null },
  stages: [], closing: [], months: [], clients: [], trend: [], buyout: null, attention: [],
};
