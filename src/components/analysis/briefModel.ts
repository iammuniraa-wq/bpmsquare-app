import {
  formatEmployees, formatMoney, formatPercent, growthOf, latest, marginOf,
} from "@/lib/analysis/report/figures";
import { contactGapsFor, type BriefHistory } from "@/lib/analysis/report/history";
import {
  OWNERSHIP_LABEL, REPORT_PART_BLOCK, SIGNAL_KIND_LABEL, type CompanyReport, type FitBasis, type ReportBlockId, type ReportPartId, type RoleFunction,
} from "@/lib/analysis/report/types";

// What the brief card draws, worked out from fields (docs/design/company-brief-sales.md sections 3 and 8). Pure, so the tiles, the
// "not published" rule, the "from" line under a fit priority and the history strip can be tested without a browser. Nothing here
// reads the web, the cache or the workspace: it only arranges a validated report and, on top of it, the person's own history.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-18" becomes "18 Oct 2026"; "2026-03" becomes "Mar 2026"; "2025" stays "2025". Anything else is shown as it is. */
export function shortDate(on: string): string {
  if (/^\d{4}$/.test(on)) return on;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(on);
  if (!m) return on;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return on;
  return m[3] ? `${Number(m[3])} ${month} ${m[1]}` : `${month} ${m[1]}`;
}

/** "12 Nov award": the date and kind of the statement a fit priority is based on, or the start of the highlight. */
export function fitFrom(r: CompanyReport, basis: FitBasis): string {
  if (basis.type === "signal") {
    const s = r.signals[basis.index];
    return s ? `${shortDate(s.on).replace(/ \d{4}$/, "")} ${SIGNAL_KIND_LABEL[s.kind]}` : "";
  }
  const h = r.performance.highlights[basis.index];
  return h ? `performance: ${h.text.length > 48 ? `${h.text.slice(0, 47).trimEnd()}…` : h.text}` : "";
}

export type Tile = {
  key: "revenue" | "profit" | "growth" | "employees" | "hq" | "ownership";
  label: string;
  value: string;
  sub: string;
  /** The source number to link, when the figure came from a page. */
  src?: number;
  /** Shown muted: the figure's digits were not found in the cited snippet, so the reader is asked to check the page. */
  check?: boolean;
  /** "Not published" or "n/a": drawn smaller and muted, never as a figure. */
  nopub?: boolean;
  tone?: "up" | "down";
};

const partNote = (r: CompanyReport, part: ReportPartId): string | null => (r.missing.includes(part) ? "Not researched" : null);

/** The six tiles of the top band, in reading order. */
export function tilesOf(r: CompanyReport): Tile[] {
  const rev = latest(r.money.revenue);
  const profit = latest(r.money.profit);
  const g = growthOf(r.money.revenue);
  const m = marginOf(r.money);
  const notFin = partNote(r, "financials");
  const notMkt = partNote(r, "market");
  const out: Tile[] = [];
  const privateCo = r.facts.ownership?.value.kind === "private";
  out.push(rev
    ? { key: "revenue", label: "Revenue", value: formatMoney(rev.amount, rev.currency), sub: `FY${rev.fiscalYear}`, src: rev.src, check: !rev.matched }
    : { key: "revenue", label: "Revenue", value: notFin ?? "Not published", nopub: true, sub: notFin ? "" : "Looked for accounts, filings, press" });
  out.push(profit
    ? { key: "profit", label: "Net profit", value: formatMoney(profit.amount, profit.currency), sub: `FY${profit.fiscalYear}${m && m.fiscalYear === profit.fiscalYear ? ` · margin ${formatPercent(m.percent)}` : ""}`, src: profit.src, check: !profit.matched }
    : { key: "profit", label: "Net profit", value: notFin ?? "Not published", nopub: true, sub: notFin ? "" : privateCo ? "Private company" : "Not in the pages found" });
  out.push(g
    ? { key: "growth", label: "Growth", value: formatPercent(g.percent, true), sub: `vs FY${g.previous.fiscalYear}, ${formatMoney(g.previous.amount, g.previous.currency)}`, tone: g.percent >= 0 ? "up" : "down", check: !g.current.matched || !g.previous.matched }
    : { key: "growth", label: "Growth", value: "n/a", nopub: true, sub: "Needs two published years" });
  const e = r.facts.employees;
  out.push(e
    ? { key: "employees", label: "Employees", value: formatEmployees(e), sub: e.on ? shortDate(e.on) : "", src: e.src, check: !e.matched }
    : { key: "employees", label: "Employees", value: notMkt ?? "Not found", nopub: true, sub: "" });
  const hq = r.facts.hq;
  out.push(hq
    ? { key: "hq", label: "Head office", value: hq.value, sub: "", src: hq.src }
    : { key: "hq", label: "Head office", value: notMkt ?? "Not found", nopub: true, sub: "" });
  const o = r.facts.ownership;
  out.push(o
    ? { key: "ownership", label: "Ownership", value: OWNERSHIP_LABEL[o.value.kind], sub: o.value.detail ?? "", src: o.src }
    : { key: "ownership", label: "Ownership", value: notMkt ?? "Not found", nopub: true, sub: "" });
  return out;
}

/** The parts whose failure leaves this block empty, so the block says "could not be researched" instead of vanishing or claiming nothing was found. */
export function partsOfBlock(id: ReportBlockId | "money"): ReportPartId[] {
  switch (id) {
    case "why_now": return ["signals", "people"];
    case "who": return ["people"];
    case "fit": return [];
    case "performance": return ["financials"];
    case "money": return ["financials"];
    case "watchouts": case "market": case "profile": return ["market"];
    case "sources": return [];
  }
}

/** Block-feeding parts that failed. */
export const missingForBlock = (r: CompanyReport, id: ReportBlockId | "money"): ReportPartId[] => partsOfBlock(id).filter((p) => r.missing.includes(p));

// The check that REPORT_PART_BLOCK and partsOfBlock stay about the same four feeds.
export const PART_FEEDS = REPORT_PART_BLOCK;

const GAP_WORD: Record<RoleFunction, string> = { procurement: "procurement", projects: "projects", operations: "operations", finance: "finance", executive: "the executive team" };
const listWords = (w: string[]): string => (w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`);

/**
 * "Your history with them" as short pieces for the strip, and the line about contacts we are missing. Each piece is shown only when
 * the person may view that object (null means it is not mentioned at all, never "0").
 */
export function historyPieces(h: BriefHistory, functions: readonly CompanyReport["roles"][number]["fn"][]): { pieces: { n?: number; text: string; href?: string }[]; gap: string | null } {
  const pieces: { n?: number; text: string; href?: string }[] = [];
  const plural = (n: number, one: string, many: string) => ({ n, text: n === 1 ? one : many });
  if (h.openDeals !== null) pieces.push(plural(h.openDeals, "open deal", "open deals"));
  if (h.openQuotes !== null) pieces.push(plural(h.openQuotes, "open quote", "open quotes"));
  if (h.openCases !== null && h.openCases > 0) pieces.push(plural(h.openCases, "open case", "open cases"));
  if (h.lastActivity) pieces.push({ text: `Last activity: ${h.lastActivity.text}`, ...(h.lastActivity.href ? { href: h.lastActivity.href } : {}) });
  if (h.owner) pieces.push({ text: `Owner ${h.owner}` });
  const gaps = contactGapsFor(h, functions);
  const gap = h.contactCount === null ? null
    : h.contactCount === 0 ? "No contacts yet."
      : gaps.length > 0 ? `${h.contactCount} ${h.contactCount === 1 ? "contact" : "contacts"}, none in ${listWords(gaps.map((g) => GAP_WORD[g]))}.` : null;
  return { pieces, gap };
}
