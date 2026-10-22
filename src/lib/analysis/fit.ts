import { normaliseName } from "./companyKey";
import type { AnalysisFactor, Claim, FitLabel, SourcedValue } from "./types";

// Fit: how well this company matches what the workspace sells. A label with named factors, never a 0 to 100 and never
// an AI call (docs/design/account-analysis.md 6.1, bpmsquarecore 10a). Pure: the same inputs give the same factors.

export type FitWeights = {
  industry: number; coverage: number; size: number; topic: number; customer: number; notInMarket: number; risk: number;
};

export const DEFAULT_FIT_WEIGHTS: FitWeights = { industry: 3, coverage: 2, size: 1, topic: 2, customer: 2, notInMarket: -3, risk: -2 };

/** Per-workspace weights, whole numbers from -5 to 5. Anything else falls back to the default for that key. */
export function resolveFitWeights(configured: unknown): FitWeights {
  const out = { ...DEFAULT_FIT_WEIGHTS };
  if (!configured || typeof configured !== "object") return out;
  for (const k of Object.keys(out) as (keyof FitWeights)[]) {
    const v = (configured as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= -5 && v <= 5) out[k] = v;
  }
  return out;
}

export const FIT_STRONG_AT = 6;
export const FIT_PARTIAL_AT = 3;

export type FitInput = {
  /** What the company says it does: the account's industry, or the industry the research reported. */
  industry: string | null;
  /** The words the workspace sells by: segment names, product categories, topic names. */
  terms: string[];
  /** Null when coverage was not evaluated (a company that is not an account). */
  coverage: { covered: boolean; where?: string; team?: string } | null;
  size: SourcedValue | null;
  /** The workspace's own size band in staff, if an admin set one. */
  sizeBand: { min?: number; max?: number } | null;
  /** Attached, found, not stale, not instruction-like. The caller filters; this function does not trust the flags blindly. */
  claims: Claim[];
  /** Null when unknown (not an account). */
  customer: { since?: string } | null;
  notInMarket: boolean;
  /** Did the web research run at all. Without it, "no topic items" is not evidence of anything. */
  researched: boolean;
  weights?: FitWeights;
};

export type FitResult = { label: FitLabel; score: number; factors: AnalysisFactor[]; dataPoints: number };

const f = (label: string, points: number, detail: string): AnalysisFactor => ({ area: "fit", group: "note", label, points, detail });

/** A leading number in "about 450 staff", "~1,200 employees", "450-500": the lower figure. */
export function parseHeadcount(text: string): number | null {
  const m = /(\d[\d,]*)/.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function industryMatch(industry: string, terms: string[]): string | null {
  const ind = normaliseName(industry);
  if (!ind) return null;
  const words = new Set(ind.split(" "));
  for (const t of terms) {
    const nt = normaliseName(t);
    if (!nt) continue;
    if (ind.includes(nt) || nt.includes(ind)) return t;
    const tw = nt.split(" ").filter((w) => w.length >= 4);
    if (tw.length > 0 && tw.every((w) => words.has(w))) return t;
  }
  return null;
}

export function computeFit(input: FitInput): FitResult {
  const w = input.weights ?? DEFAULT_FIT_WEIGHTS;
  const factors: AnalysisFactor[] = [];
  let data = 0;

  if (input.industry && input.industry.trim()) {
    data++;
    const hit = industryMatch(input.industry, input.terms);
    factors.push(hit
      ? f("Industry matches what you sell", w.industry, `${input.industry.trim()} matches "${hit}"`)
      : f("Industry does not match yet", 0, `${input.industry.trim()} is not one of your segments or subjects`));
  }

  if (input.coverage) {
    data++;
    factors.push(input.coverage.covered
      ? f("Inside your coverage", w.coverage, `${input.coverage.where ?? "This place"} is covered${input.coverage.team ? ` by ${input.coverage.team}` : ""}`)
      : f("Outside your coverage", 0, `${input.coverage.where ?? "This place"} is not in a coverage rule`));
  }

  if (input.size) {
    data++;
    const n = parseHeadcount(input.size.value);
    const band = input.sizeBand;
    if (band && (band.min !== undefined || band.max !== undefined) && n !== null) {
      const inside = (band.min === undefined || n >= band.min) && (band.max === undefined || n <= band.max);
      factors.push(inside
        ? f("Size is in your sweet spot", w.size, `${input.size.value} (${input.size.asOf.slice(0, 7)})`)
        : f("Size is outside your sweet spot", 0, `${input.size.value} (${input.size.asOf.slice(0, 7)})`));
    }
  }

  if (input.researched) {
    data++;
    const topical = input.claims.filter((c) => c.topic && c.confidence === "found" && !c.stale && !c.instructionLike);
    if (topical.length > 0) {
      const topics = [...new Set(topical.map((c) => c.topic!))].sort();
      factors.push(f("News about your subjects", Math.min(Math.abs(w.topic), topical.length) * Math.sign(w.topic),
        `${topical.length} ${topical.length === 1 ? "item" : "items"} on ${topics.map((t) => `"${t}"`).join(", ")}`));
    }
    const risks = input.claims.filter((c) => c.kind === "risk" && c.confidence === "found" && !c.stale && !c.instructionLike);
    if (risks.length > 0) factors.push(f("Bad news reported", w.risk, `${risks.length} ${risks.length === 1 ? "report" : "reports"} in the last 6 months`));
  }

  if (input.customer) {
    data++;
    factors.push(f("Already a customer", w.customer, input.customer.since ? `Customer since ${input.customer.since}` : "Has bought from you"));
  }

  if (input.notInMarket) factors.push(f("Marked not in market", w.notInMarket, "Your team marked this account in the last 30 days"));

  const score = factors.reduce((t, x) => t + x.points, 0);
  const label: FitLabel = data < 2 ? "unknown" : score >= FIT_STRONG_AT ? "strong" : score >= FIT_PARTIAL_AT ? "partial" : "weak";
  return { label, score, factors, dataPoints: data };
}
