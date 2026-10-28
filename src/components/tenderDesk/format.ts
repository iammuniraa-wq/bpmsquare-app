import type { TenderDeskBuyoutPackage, TenderDeskClient, TenderDeskData, TenderDeskMonth, TenderDeskTrendPoint } from "@/lib/tenderDesk/types";
import { money } from "@/lib/contractProjects/format";

// Pure display helpers for both Tender desk styles. No colours here (theme.ts holds them), no React.

const MILLION = 1_000_000;
const finite = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** "92.6M". A missing number is a dash, never "0.0M". */
export function millions(n: number | null | undefined, digits = 1): string {
  return finite(n) ? `${(n / MILLION).toFixed(digits)}M` : "—";
}

/** Millions from one million up, thousands from ten thousand, whole numbers below: "92.6M", "750K", "4,200". */
export function compact(n: number | null | undefined, digits = 1): string {
  if (!finite(n)) return "—";
  const a = Math.abs(n);
  if (a >= MILLION) return millions(n, digits);
  if (a >= 10_000) return `${Math.round(n / 1000)}K`;
  return Math.round(n).toLocaleString("en-US");
}

/** A big number and its small unit, as the tiles draw them: { value: "92.6", unit: "M SAR" }. */
export function tileMoney(n: number | null | undefined, currency: string): { value: string; unit: string } {
  if (!finite(n)) return { value: "—", unit: currency };
  const a = Math.abs(n);
  if (a >= MILLION) return { value: (n / MILLION).toFixed(1), unit: `M ${currency}` };
  if (a >= 10_000) return { value: String(Math.round(n / 1000)), unit: `K ${currency}` };
  return { value: Math.round(n).toLocaleString("en-US"), unit: currency };
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "55%" from 0..1, a dash when nothing was decided. */
export function winRateLabel(winRate: number | null | undefined): string {
  return finite(winRate) ? `${Math.round(winRate * 100)}%` : "—";
}

/** Whole percent of a part in a whole, null when the whole is zero or missing. */
export function percentOf(part: number | null | undefined, whole: number | null | undefined): number | null {
  if (!finite(part) || !finite(whole) || whole <= 0) return null;
  return Math.max(0, Math.round((part / whole) * 100));
}

export const daysText = (daysLeft: number): string => (daysLeft <= 0 ? "Today" : plural(daysLeft, "day"));

/** The day chip: a big figure and a small word, so the chip reads "3 days" without its colour. */
export function dayChip(daysLeft: number): { big: string; small: string } {
  return daysLeft <= 0 ? { big: "0", small: "today" } : { big: String(daysLeft), small: daysLeft === 1 ? "day" : "days" };
}

/** Red up to 3 days, amber up to 10, otherwise green (spec: Bids closing soonest). */
export type DayTone = "red" | "amber" | "green";
export const dayTone = (daysLeft: number): DayTone => (daysLeft <= 3 ? "red" : daysLeft <= 10 ? "amber" : "green");

/** Bar width as a whole percent of the largest value; a non-zero value never vanishes. */
export function barPercent(value: number, max: number): number {
  if (!finite(value) || !finite(max) || max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.max(2, Math.round((value / max) * 100)));
}

/** A ring drawn with a dashed stroke: `fraction` 0..1 of the circumference. */
export function ringDash(fraction: number | null | undefined, radius = 36): { dash: number; circumference: number } {
  const circumference = 2 * Math.PI * radius;
  const f = finite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return { dash: Number((f * circumference).toFixed(1)), circumference: Number(circumference.toFixed(1)) };
}

export type DonutSegment = { dash: number; offset: number; share: number };

/** Segments of a donut with the given radius: dash length, negative start offset, share 0..1. Empty when there is nothing to draw. */
export function donutSegments(values: number[], radius = 54): DonutSegment[] {
  const total = values.reduce((s, v) => s + (finite(v) && v > 0 ? v : 0), 0);
  if (total <= 0) return [];
  const circumference = 2 * Math.PI * radius;
  let used = 0;
  return values.map((raw) => {
    const v = finite(raw) && raw > 0 ? raw : 0;
    const dash = (v / total) * circumference;
    const seg = { dash: Number(dash.toFixed(1)), offset: Number((-used).toFixed(1)), share: v / total };
    used += dash;
    return seg;
  });
}

export type TrendGeometry = {
  line: string;
  area: string;
  /** The last point as a percentage of the drawing, to place the end dot in HTML so it is not squashed. */
  lastXPct: number;
  lastYPct: number;
  delta: number;
  from: string;
  to: string;
};

/** The 12-week open value as an SVG line and area in a width x height box; null when there are fewer than two points. */
export function trendGeometry(points: TenderDeskTrendPoint[], width = 520, height = 120, pad = 14): TrendGeometry | null {
  if (points.length < 2) return null;
  const vs = points.map((p) => p.openValue);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const xy = points.map((p, i) => {
    const x = (i / (points.length - 1)) * width;
    const y = max === min ? height / 2 : pad + (1 - (p.openValue - min) / span) * (height - pad * 2);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))] as const;
  });
  const line = xy.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  const last = xy[xy.length - 1];
  return {
    line,
    area: `${line} L${width} ${height} L0 ${height} Z`,
    lastXPct: Number(((last[0] / width) * 100).toFixed(2)),
    lastYPct: Number(((last[1] / height) * 100).toFixed(2)),
    delta: vs[vs.length - 1] - vs[0],
    from: points[0].weekEnd,
    to: points[points.length - 1].weekEnd,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "4 Aug" from an ISO date or timestamp (the date part is read as written, never shifted by a time zone). */
export function shortDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return "—";
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""}`.trim();
}

/** "+31.6M since 4 Aug" / "-5.2M since 4 Aug" / "no change since 4 Aug". */
export function trendDeltaText(delta: number, from: string): string {
  if (!finite(delta) || Math.abs(delta) < 50_000) return `no change since ${shortDate(from)}`;
  return `${delta > 0 ? "+" : "-"}${millions(Math.abs(delta))} since ${shortDate(from)}`;
}

export type TimelineAlign = "start" | "center" | "end";

/** Where a bid sits on the 28-day axis (0..100) and how its label is anchored so it never leaves the box. */
export function timelinePosition(daysLeft: number, horizon = 28): { pct: number; align: TimelineAlign } {
  const pct = Math.min(100, Math.max(0, Number(((daysLeft / horizon) * 100).toFixed(1))));
  return { pct, align: pct <= 8 ? "start" : pct >= 92 ? "end" : "center" };
}

/**
 * Which row each deadline label sits on, so two labels never overlap. Lanes: 0 above the axis (nearest), 1 below (nearest), 2 above (second row),
 * 3 below (second row). A label is about 27% of the axis wide at the narrowest width the timeline is drawn (150 px of 560); a label near the
 * left edge starts at its marker and one near the right edge ends at it, as timelinePosition says. Greedy, in marker order.
 */
export function assignLanes(positions: readonly { pct: number; align: TimelineAlign }[], labelPct = 27): number[] {
  const lastEnd: number[] = [-Infinity, -Infinity, -Infinity, -Infinity];
  return positions.map(({ pct, align }) => {
    const left = align === "start" ? pct : align === "end" ? pct - labelPct : pct - labelPct / 2;
    const right = left + labelPct;
    let lane = lastEnd.findIndex((end) => end <= left);
    if (lane < 0) lane = lastEnd.indexOf(Math.min(...lastEnd));
    lastEnd[lane] = right;
    return lane;
  });
}

export type BuyoutRow = {
  trackPct: number;
  committedPct: number;
  /** Best quote as a percentage of the budget, held inside the track; null without a quote. */
  quotePct: number | null;
  diff: { text: string; kind: "under" | "over" | "none" };
};

/** One buy-out package as the card draws it: budget track, awarded fill, best-quote marker and the gap in words. */
export function buyoutRow(pkg: TenderDeskBuyoutPackage, maxBudget: number): BuyoutRow {
  const marker = pkg.bestQuote ?? pkg.committed;
  const reference = pkg.committed ?? pkg.bestQuote;
  let diff: BuyoutRow["diff"] = { text: "no quote yet", kind: "none" };
  if (finite(reference)) {
    const gap = pkg.budget - reference;
    diff = Math.abs(gap) < 5_000 ? { text: "on budget", kind: "under" } : gap > 0 ? { text: `${millions(gap, 2)} under`, kind: "under" } : { text: `${millions(-gap, 2)} over`, kind: "over" };
  }
  return {
    trackPct: barPercent(pkg.budget, maxBudget),
    committedPct: finite(pkg.committed) && pkg.budget > 0 ? Math.min(100, Math.round((pkg.committed / pkg.budget) * 100)) : 0,
    quotePct: finite(marker) && pkg.budget > 0 ? Math.min(100, Math.max(0, Math.round((marker / pkg.budget) * 100))) : null,
    diff,
  };
}

export type Sentence = { text: string; bold?: boolean }[];

/** The one sentence of figures under the Bold greeting, as runs so the screen can bold the numbers without raw HTML. */
export function deskSentence(data: Pick<TenderDeskData, "currency" | "kpis" | "closing">): Sentence {
  const { kpis, closing, currency } = data;
  if (kpis.openCount === 0) return [{ text: "No tenders are open right now." }];
  const out: Sentence = [
    { text: "The open pipeline stands at " },
    { text: `${currency} ${millions(kpis.openValue)}`, bold: true },
    { text: " across " },
    { text: plural(kpis.openCount, "tender"), bold: true },
    { text: ". " },
  ];
  if (kpis.closingSoonCount === 0) {
    out.push({ text: "No bid closes within 14 days." });
    return out;
  }
  out.push({ text: plural(kpis.closingSoonCount, "bid"), bold: true }, { text: kpis.closingSoonCount === 1 ? " closes within 14 days" : " close within 14 days" });
  const first = closing[0];
  if (first && first.daysLeft <= 14) {
    out.push({ text: ", the first " }, { text: first.daysLeft <= 0 ? "today" : `in ${daysText(first.daysLeft)}`, bold: true });
  }
  out.push({ text: "." });
  return out;
}

export const sentenceText = (s: Sentence): string => s.map((r) => r.text).join("");

/** "Nov 1 won, 1 lost; Dec 1 won, 0 lost; ..." for the chart's aria-label. */
export function monthsAria(months: TenderDeskMonth[]): string {
  return `Won and lost tenders by month. ${months.map((m) => `${m.label} ${m.won} won, ${m.lost} lost`).join("; ")}.`;
}

export const monthsMax = (months: TenderDeskMonth[]): number => months.reduce((m, x) => Math.max(m, x.won, x.lost), 0);
export const monthsHaveData = (months: TenderDeskMonth[]): boolean => monthsMax(months) > 0;

export function clientsAria(clients: TenderDeskClient[], currency: string): string {
  return `Open value by client, ${currency}. ${clients.map((c) => `${c.name} ${millions(c.value)}`).join("; ")}.`;
}

export function trendAria(points: TenderDeskTrendPoint[], currency: string): string {
  if (points.length < 2) return "Open pipeline over the last 12 weeks: not enough history yet.";
  const a = points[0];
  const b = points[points.length - 1];
  return `Open pipeline over the last 12 weeks, ${currency}: from ${millions(a.openValue)} on ${shortDate(a.weekEnd)} to ${millions(b.openValue)} on ${shortDate(b.weekEnd)}.`;
}

export function stagesAria(stages: { label: string; count: number; value: number }[], currency: string): string {
  return `Open pipeline by stage, ${currency}. ${stages.map((s) => `${s.label} ${millions(s.value)}, ${plural(s.count, "tender")}`).join("; ")}.`;
}

/** The full figure for a tooltip or label where the compact one would lose precision: "SAR 92,600,000". */
export const fullMoney = (n: number, currency: string): string => money(n, currency);
