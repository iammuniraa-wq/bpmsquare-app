import { STAGE_LABEL } from "@/lib/signals/types";
import { FIT_TEXT, VERDICT_TEXT, type AnalysisSnapshot, type Change, type Claim } from "./types";

// "What changed since last time" (docs/design/account-analysis.md 4). Claims are compared by source address and kind, so
// a re-worded sentence about the same article is not "new". Pure and deterministic: the order of the output is fixed.

const keyOf = (c: Claim) => `${c.source.url}|${c.kind}`;

const short = (t: string) => (t.length > 100 ? `${t.slice(0, 97)}...` : t);

export function diffAnalyses(prev: AnalysisSnapshot | null, next: AnalysisSnapshot): Change[] {
  if (!prev) return [];
  const out: Change[] = [];
  const before = new Map(prev.claims.map((c) => [keyOf(c), c]));
  const after = new Map(next.claims.map((c) => [keyOf(c), c]));

  const added = [...after.entries()].filter(([k]) => !before.has(k)).map(([, c]) => c)
    .sort((a, b) => (b.publishedOn ?? "").localeCompare(a.publishedOn ?? "") || a.source.url.localeCompare(b.source.url));
  for (const c of added) out.push({ kind: "new_claim", text: short(c.text) });

  const gone = [...before.entries()].filter(([k]) => !after.has(k)).map(([, c]) => c)
    .sort((a, b) => a.source.url.localeCompare(b.source.url));
  for (const c of gone) out.push({ kind: "gone_claim", text: short(c.text) });

  if (prev.verdict !== next.verdict) out.push({ kind: "verdict", text: `${VERDICT_TEXT[prev.verdict]} became ${VERDICT_TEXT[next.verdict]}` });
  if (prev.fit !== next.fit) out.push({ kind: "fit", text: `Fit ${FIT_TEXT[prev.fit]} became ${FIT_TEXT[next.fit]}` });
  if (prev.stage !== next.stage) out.push({ kind: "timing", text: `${STAGE_LABEL[prev.stage]} became ${STAGE_LABEL[next.stage]}` });
  return out;
}

/** Only a new finding is worth a note to the account owner. A move of the verdict alone is shown on the card, not sent. */
export const hasNewFindings = (changes: readonly Change[] | undefined): boolean => !!changes?.some((c) => c.kind === "new_claim");
