import { ANALYSIS_EMPTY } from "./tips";
import { isStaleOn, sourceId } from "./validate";
import { computeFit, DEFAULT_FIT_WEIGHTS, type FitInput, type FitWeights } from "./fit";
import { diffAnalyses } from "./diff";
import { toHighlights } from "./highlights";
import { buildVerdict, computeTiming, type IntentInput } from "./verdict";
import type { Subject } from "./subject";
import type { AnalysisCard, AnalysisSnapshot, Change, Claim, InSystem, PublicPerson, SourceRef, SourcedValue } from "./types";

// Puts the card together from the stored web half and the live half (docs/design/account-analysis.md 4: only the web half
// is stored; the workspace's own records are read on every render). Pure: the same stored research and the same live inputs
// give the same card, so the verdict is identical on two renders of the same row.

/** The web half, as the cache keeps it. Claims are the validated ones: attached in `claims`, parked in `checkThese`. */
export type StoredResearch = {
  v: 1;
  claims: Claim[];
  checkThese: Claim[];
  size: SourcedValue | null;
  people: PublicPerson[];
  sources: SourceRef[];
  sentence: { text: string; byAi: boolean; forLabel: string } | null;
  snapshot: AnalysisSnapshot;
  /** How many items the search returned that could not be tied to this company with a checkable source (dropped or parked). Absent in older rows. */
  unverified?: number;
};

export type LiveInputs = {
  intent: IntentInput | null;
  inSystem: InSystem;
  coverage: FitInput["coverage"];
  terms: string[];
  sizeBand: FitInput["sizeBand"];
  customer: FitInput["customer"];
  notInMarket: boolean;
  weights?: FitWeights;
};

export type ComposeIn = {
  id: string;
  companyKey: string;
  accountId: string | null;
  subject: Subject;
  /** Null when the web was not used: the card says so and scores on the workspace's own records alone. */
  research: StoredResearch | null;
  live: LiveInputs;
  now: Date;
  computedAt: string;
  expiresAt: string;
  previous: AnalysisSnapshot | null;
  /** Extra plain notes, such as "Not saved: database update pending". */
  notes?: string[];
};

/** Claims age after they are stored: staleness is always judged against today, never against the day they were found. */
export const refreshStale = (c: Claim, now: Date): Claim => ({ ...c, stale: isStaleOn(c.publishedOn, now) });

export function composeCard(i: ComposeIn): AnalysisCard {
  const claims = (i.research?.claims ?? []).map((c) => refreshStale(c, i.now));
  const checkThese = (i.research?.checkThese ?? []).map((c) => refreshStale(c, i.now));
  const size = i.research?.size ?? null;
  const live = i.live;

  const fit = computeFit({
    industry: i.subject.industry, terms: live.terms, coverage: live.coverage, size, sizeBand: live.sizeBand,
    claims: claims.filter((c) => !c.instructionLike), customer: live.customer, notInMarket: live.notInMarket,
    researched: !!i.research, weights: live.weights ?? DEFAULT_FIT_WEIGHTS,
  });
  const timing = computeTiming({ intent: live.intent, claims: claims.filter((c) => !c.instructionLike), now: i.now });
  const verdict = buildVerdict({ fit, timing, claims: claims.filter((c) => !c.instructionLike), now: i.now });

  // The AI sentence belongs to the verdict it was written for. If the records moved the verdict since, the plain one is true.
  const stored = i.research?.sentence;
  if (stored && stored.byAi && stored.forLabel === verdict.label) verdict.sentence = { text: stored.text, byAi: true };

  const snapshot: AnalysisSnapshot = { claims, fit: verdict.fit, stage: verdict.timing.stage, verdict: verdict.label };
  const changes: Change[] = diffAnalyses(i.previous, snapshot);

  const doing = toHighlights(claims, i.now);
  const notes = [...(i.notes ?? [])];
  if (!i.research) notes.push(ANALYSIS_EMPTY.needsWeb);
  else if (doing.length === 0) {
    notes.push(ANALYSIS_EMPTY.littleInfo);
    // "Nothing found" and "found things we could not confirm" are different answers: say which, so a thin card is not read as a quiet company.
    const unverified = i.research.unverified ?? 0;
    if (unverified > 0) notes.push(ANALYSIS_EMPTY.unverified(unverified, i.subject.name));
  }

  const identity = [
    [i.subject.city, i.subject.country].filter(Boolean).join(", "),
    i.subject.industry,
    size ? size.value : null,
  ].filter(Boolean).join(" · ") || i.subject.domain || "";

  const refs = new Map<string, SourceRef>();
  for (const s of i.research?.sources ?? []) refs.set(s.url, s);

  return {
    id: i.id, companyKey: i.companyKey, accountId: i.accountId, name: i.subject.name, identity, verdict, doing,
    inSystem: live.inSystem, nextSteps: [], refreshedAt: i.computedAt, expiresAt: i.expiresAt,
    stale: Date.parse(i.expiresAt) <= i.now.getTime(),
    ...(changes.length > 0 ? { changes } : {}), notes,
    internal: { sources: [...refs.values()], claims, checkThese, publicPeople: i.research?.people ?? [] },
  };
}

export const cardId = (companyKey: string, computedAt: string): string => `an_${sourceId(`${companyKey}@${computedAt}`)}`;

/** What to store for the next render and the next diff. */
export function toStored(i: { claims: Claim[]; checkThese: Claim[]; size: SourcedValue | null; people: PublicPerson[]; sources: SourceRef[]; unverified?: number; card: AnalysisCard }): StoredResearch {
  const sentence = i.card.verdict.sentence;
  return {
    v: 1, claims: i.claims, checkThese: i.checkThese, size: i.size, people: i.people, sources: i.sources, ...(i.unverified ? { unverified: i.unverified } : {}),
    sentence: sentence.byAi ? { text: sentence.text, byAi: true, forLabel: i.card.verdict.label } : null,
    snapshot: { claims: i.card.internal.claims, fit: i.card.verdict.fit, stage: i.card.verdict.timing.stage, verdict: i.card.verdict.label },
  };
}
