import { refreshStale, type StoredResearch } from "./compose";
import { claimsToSignals } from "./toSignals";
import type { Claim } from "./types";
import type { RawSignal } from "@/lib/signals/types";

// The signals feed (docs/design/account-analysis.md 6.2): what a saved analysis found on the web becomes Buying signals
// in the "They are moving" group, for the account it belongs to. Pure: saved rows in, signals out. No third score -- these
// go through the same rubric, caps and fading as every other signal, and their kinds are off-line so the stage thresholds
// of a workspace that has never analysed anything stay exactly where they are.

export type AnalysisRowForFeed = { account_id: string | null; data: unknown };

const validData = (d: unknown): d is StoredResearch => !!d && typeof d === "object" && (d as StoredResearch).v === 1 && Array.isArray((d as StoredResearch).claims);

/**
 * One signal per (account, kind, day). Two articles about the same award on the same day, or the same claim kept by two
 * saved rows for one account, are one occurrence. Only attached claims are read (never "Check these"); staleness is judged
 * against today, not the day the page was found. The timeline line is the claim's own text and the signal carries no
 * address (sources are kept for audit and are not drawn).
 */
export function analysisFeed(rows: readonly AnalysisRowForFeed[], now: Date): Map<string, RawSignal[]> {
  const out = new Map<string, RawSignal[]>();
  const seen = new Set<string>();
  const ordered = [...rows].sort((a, b) => String(a.account_id).localeCompare(String(b.account_id)));
  for (const row of ordered) {
    if (!row.account_id || !validData(row.data)) continue;
    const claims: Claim[] = row.data.claims.map((c) => refreshStale(c, now)).sort((a, b) => a.text.localeCompare(b.text));
    for (const c of claims) {
      const [s] = claimsToSignals([c]);
      if (!s) continue;
      const day = s.occurredAt.slice(0, 10);
      const key = `${row.account_id}|${s.kind}|${day}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const signal: RawSignal = { ...s, key: `web:${s.kind}:${day}` };
      const list = out.get(row.account_id);
      if (list) list.push(signal); else out.set(row.account_id, [signal]);
    }
  }
  return out;
}
