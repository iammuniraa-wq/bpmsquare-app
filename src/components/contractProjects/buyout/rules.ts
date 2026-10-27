import type { PillarKey } from "@/lib/theme";
import { MIN_REASON_CHARS } from "@/lib/rfq/comparison";
import { money, signedMoney } from "@/lib/contractProjects/format";
import type { BuyoutData, Handover, PackageRow, PackageStatus, Quote, Round } from "./types";

// Small, pure display rules for the Buy-out screens: the words and tones of a status, the filter counts, what the tiles say under their
// figure, which quote is the lowest valid one, when an award needs a reason. The server decides again on every call.

export const STATUS_LABEL: Record<PackageStatus, string> = {
  draft: "Not sent", out: "Out", ready: "Ready to award", awarded: "Awarded", handed_over: "Handed over",
};
export const STATUS_TONE: Record<PackageStatus, PillarKey> = {
  draft: "purple", out: "blue", ready: "amber", awarded: "green", handed_over: "teal",
};

/** "Out, 2 of 3 replied" when the row says how many were asked; plain "Out" otherwise. */
export function statusText(p: Pick<PackageRow, "status" | "asked" | "replied">): string {
  if (p.status === "out" && typeof p.asked === "number" && p.asked > 0) return `Out, ${p.replied ?? 0} of ${p.asked} replied`;
  return STATUS_LABEL[p.status];
}

export const FILTERS = ["all", "draft", "out", "ready", "awarded", "handed_over"] as const;
export type BuyoutFilter = (typeof FILTERS)[number];
export const FILTER_LABEL: Record<BuyoutFilter, string> = { all: "All", draft: "Not sent", out: "Out", ready: "Ready to award", awarded: "Awarded", handed_over: "Handed over" };

export function filterCounts(packages: readonly Pick<PackageRow, "status">[]): Record<BuyoutFilter, number> {
  const out: Record<BuyoutFilter, number> = { all: packages.length, draft: 0, out: 0, ready: 0, awarded: 0, handed_over: 0 };
  for (const p of packages) out[p.status] += 1;
  return out;
}

export const applyFilter = <T extends Pick<PackageRow, "status">>(packages: readonly T[], f: BuyoutFilter): T[] => (f === "all" ? [...packages] : packages.filter((p) => p.status === f));

export const HANDOVER_LABEL: Record<Handover["state"], string> = { not_ready: "Not ready", ready: "Ready", sent: "Sent" };
export const HANDOVER_TONE: Record<Handover["state"], PillarKey> = { not_ready: "purple", ready: "blue", sent: "green" };

/** What each tile says under its figure, worked out from the rows. */
export function tileSubs(data: Pick<BuyoutData, "tiles" | "packages">, currency: string | null) {
  const { tiles, packages } = data;
  const n = (s: PackageStatus) => packages.filter((p) => p.status === s).length;
  const awarded = n("awarded") + n("handed_over");
  const lines = packages.reduce((a, p) => a + (p.line_count || 0), 0);
  const share = tiles.budget > 0 ? Math.round((tiles.committed / tiles.budget) * 100) : 0;
  const over = tiles.committed > tiles.budget && tiles.budget > 0;
  return {
    budget: `${tiles.packages} package${tiles.packages === 1 ? "" : "s"}, ${lines} budget line${lines === 1 ? "" : "s"}`,
    committed: over ? `over the budget by ${money(tiles.committed - tiles.budget, currency)}` : `${share}% of the budget, ${awarded} awarded`,
    committedTone: (over ? "warn" : "info") as "warn" | "info",
    best: tiles.best_vs_budget >= 0 ? "under budget where quotes are in" : "over budget where quotes are in",
    bestTone: (tiles.best_vs_budget >= 0 ? "good" : "warn") as "good" | "warn",
    bestValue: signedMoney(tiles.best_vs_budget, currency),
    decision: `${n("ready")} ready to award, ${n("out")} waiting on replies`,
  };
}

/** The against-budget cell: "12,000 under" or "3,500 over"; a dash while there is nothing to compare. */
export function againstText(p: Pick<PackageRow, "against_budget">, currency: string | null): { text: string; tone: "good" | "bad" | "none" } {
  const d = p.against_budget;
  if (d === null || d === undefined || !Number.isFinite(d)) return { text: "—", tone: "none" };
  if (d === 0) return { text: "On budget", tone: "none" };
  return { text: `${money(Math.abs(d), currency)} ${d > 0 ? "under" : "over"}`, tone: d > 0 ? "good" : "bad" };
}

/** Rounds newest first. The current round is the one the package points at, or else the newest. */
export function orderRounds(rounds: readonly Round[]): Round[] {
  return [...rounds].sort((a, b) => b.round - a.round);
}
export function currentRound(rounds: readonly Round[], currentRfqId: string | null): Round | null {
  const ordered = orderRounds(rounds);
  return ordered.find((r) => r.rfq_id === currentRfqId) ?? ordered[0] ?? null;
}

/** The lowest price among quotes that are valid and answered. Server flags are trusted; this is for rounds shown without them. */
export function lowestValid(quotes: readonly Quote[]): number | null {
  const v = quotes.filter((q) => q.valid && q.total !== null).map((q) => q.total as number);
  return v.length ? Math.min(...v) : null;
}

/** A line for the audit table: how many replied and the lowest valid price. */
export function roundResult(r: Round, currency: string | null): string {
  const replied = r.quotes.filter((q) => q.total !== null).length;
  const low = lowestValid(r.quotes);
  const base = `${replied} of ${r.quotes.length} replied`;
  return low === null ? base : `${base}, lowest ${money(low, currency)}`;
}

/** An award that is not the lowest valid price (or whose answer is expired or stale) must say why. */
export const awardNeedsReason = (q: Pick<Quote, "lowest_valid">) => !q.lowest_valid;
export const reasonOk = (text: string) => text.trim().length >= MIN_REASON_CHARS;

/** Warns, never blocks. */
export function overBudget(committed: number | null | undefined, budget: number | null | undefined): number {
  if (committed == null || budget == null || !Number.isFinite(committed) || !Number.isFinite(budget)) return 0;
  return committed > budget ? Math.round((committed - budget) * 100) / 100 : 0;
}

/** Whether Buy-out belongs on a contract project: it came from a tender, and the tender and contract project modules are on. */
export function buyoutVisible(project: { source_opportunity_id: string | null }, features: { gcc_tender?: boolean; contract_projects?: boolean } | null | undefined): boolean {
  return !!project.source_opportunity_id && features?.gcc_tender === true && features?.contract_projects === true;
}

/** A budget line's committed amount from the buy-out map, by its stable key first and its id second. */
export function committedFor(map: Record<string, number> | null | undefined, line: { id?: string | null; line_key?: string | null }): number | null {
  if (!map) return null;
  const v = (line.line_key ? map[line.line_key] : undefined) ?? (line.id ? map[line.id] : undefined);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
