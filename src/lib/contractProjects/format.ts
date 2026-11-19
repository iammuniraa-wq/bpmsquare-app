import { coverageText, type MarginCoverage, type MarginState, type MarginView } from "./budget";
import type { Tone } from "@/lib/ui/tone";

// Small, pure display helpers shared by the contract project screens (server and client).

export const money = (n: number | null | undefined, currency?: string | null, digits = 0): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${currency ? `${currency} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** A change with its sign always shown ("+SAR 1,200", "-SAR 300"); zero has none. */
export const signedMoney = (n: number | null | undefined, currency?: string | null, digits = 0): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "-" : ""}${money(Math.abs(n), currency, digits)}`;

export const pct =(n: number | null | undefined): string => (n === null || n === undefined ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

export const day = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** The tone of a status chip: StatusPill's tones. */
export const projectTone = (status: string): "blue" | "amber" | "green" | "red" | "teal" =>
  status === "active" ? "green" : status === "baseline_pending" ? "amber" : status === "closed" ? "teal" : "blue";

/**
 * What a margin tile says. A budget with lines still waiting for a cost never shows a bare percentage as if it were final: it shows the
 * margin of the allocated lines with "on 2 of 12 lines", or "Not complete" when that cannot be worked out. `sub` is null when the margin
 * is whole (or there is none yet): the tile then keeps its own sub line.
 */
export function marginWords(margin: Pick<MarginView, "pct" | "state">, cov: MarginCoverage, noun = "lines"): { value: string; sub: string | null; partial: boolean } {
  if (margin.state === "none" && margin.pct !== null) return { value: "Not allocated yet", sub: null, partial: false };
  if (cov.allocated === 0 || cov.complete) return { value: pct(margin.pct), sub: null, partial: false };
  return cov.pct === null
    ? { value: "Not complete", sub: `${cov.allocated} of ${cov.of} ${noun} allocated`, partial: true }
    : { value: pct(cov.pct), sub: `${coverageText(cov, noun)} · not complete`, partial: true };
}

/** The tile tone of a planned margin: red when negative, amber under the workspace floor, green otherwise, plain while there is none. */
export const marginTone = (state: MarginState): Tone => (state === "over" ? "bad" : state === "low" ? "warn" : state === "ok" ? "good" : "neutral");
