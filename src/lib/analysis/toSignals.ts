import { sourceId } from "./validate";
import type { Claim } from "./types";
import type { RawSignal, SignalKind } from "@/lib/signals/types";

// Web claims become Buying signals (docs/design/account-analysis.md 6.2). Only a claim that is attached to the company,
// found (not "unsure"), dated, not stale and not instruction-like can score; everything parked in Check these, and
// anything a page tried to steer, never reaches the rubric. Pure.

export function kindFor(c: Claim): SignalKind | null {
  switch (c.kind) {
    case "tender": return c.tenderRole === "issuer" ? "web_tender_issued" : "web_tender_named";
    case "award": case "project": case "expansion": case "funding": return "web_award";
    case "hiring": return "web_hiring";
    case "risk": return "web_risk";
    default: return null;
  }
}

export function claimsToSignals(claims: readonly Claim[]): RawSignal[] {
  const out: RawSignal[] = [];
  for (const c of claims) {
    const kind = kindFor(c);
    if (!kind || c.confidence !== "found" || c.stale || c.instructionLike || !c.publishedOn) continue;
    out.push({
      kind, source: "web", key: `web:${sourceId(c.source.url)}`, occurredAt: `${c.publishedOn}T00:00:00.000Z`,
      // The line is the finding in the company's own words. The page it came from is kept for audit and is never drawn
      // (owner correction 2026-10-22): no publisher in the line, no address on the signal.
      headline: c.text, ...(c.topic ? { topic: c.topic } : {}),
    });
  }
  return out;
}
