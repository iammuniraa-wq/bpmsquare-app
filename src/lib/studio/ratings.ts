import type { CapabilityEntry } from "@/lib/capability/generate";
import { MODEL_RATINGS, type Confidence, type ModelRating, type Rating } from "./types";

// "The model proposes, code decides" for the fit report
// (docs/process-design-studio-architecture.md sections 4 and 6.2). The model
// answers with a rating and catalogue ids; this function is the only thing that
// turns that into a stored rating. A claim with no id is not a claim: it becomes
// Needs review, never Standard. Pure, so every rule is tested.

export type RawFit = {
  step_id: string;
  rating: string;
  capability_ids: string[];
  why: string;
  confidence: string;
};

export type CheckedFit = {
  step_id: string;
  rating: Rating;
  capability_ids: string[];
  why: string;
  confidence: Confidence;
  warnings: string[];
};

/** What counts as "set up in Settings or with your own fields" for a Needs setup rating. */
const SETUP_KINDS = new Set(["setting", "field"]);

const isModelRating = (r: string): r is ModelRating => (MODEL_RATINGS as readonly string[]).includes(r);
const asConfidence = (c: string): Confidence => (c === "sure" || c === "likely" ? c : "check_with_us");

export function checkFit(
  raw: RawFit,
  catalogue: ReadonlyMap<string, CapabilityEntry>,
  /** The ids this area's prompt offered: a citation outside it cannot be trusted. */
  allowed: ReadonlySet<string>,
  opts: { includeUnreleased?: boolean } = {},
): CheckedFit {
  const warnings: string[] = [];
  const kept: CapabilityEntry[] = [];
  const unreleased: CapabilityEntry[] = [];
  let dropped = 0;

  for (const id of [...new Set(raw.capability_ids ?? [])]) {
    const entry = catalogue.get(id);
    if (!entry) { warnings.push(`Dropped "${id}": not in the capability catalogue.`); dropped++; continue; }
    if (!allowed.has(id)) { warnings.push(`Dropped "${id}": it was not offered for this area.`); dropped++; continue; }
    if (entry.status !== "live") {
      if (opts.includeUnreleased) { unreleased.push(entry); continue; }
      warnings.push(`Dropped "${id}": not released, so it cannot be offered to a client.`);
      dropped++;
      continue;
    }
    kept.push(entry);
  }

  const why = (raw.why ?? "").trim();
  let confidence = asConfidence(raw.confidence);
  const result = (rating: Rating, ids: string[]): CheckedFit => ({
    step_id: raw.step_id,
    rating,
    capability_ids: ids,
    why,
    confidence: rating === "needs_review" ? "check_with_us" : dropped > 0 && confidence === "sure" ? "likely" : confidence,
    warnings,
  });
  const review = (reason: string): CheckedFit => { warnings.push(reason); return result("needs_review", kept.map((e) => e.id)); };

  if (!isModelRating(raw.rating)) return review(`Unknown rating "${raw.rating}".`);
  if (!why) return review("No explanation was given for the rating.");

  // Only unreleased things back this row (and the owner has chosen to show them).
  if (kept.length === 0 && unreleased.length > 0) {
    return result("coming", unreleased.map((e) => e.id));
  }

  const ids = kept.map((e) => e.id);
  switch (raw.rating) {
    case "standard": {
      if (kept.length === 0) return review("Rated Standard without a named module, screen or setting behind it.");
      break;
    }
    case "needs_setup": {
      if (!kept.some((e) => SETUP_KINDS.has(e.kind))) {
        return review("Rated Needs setup without a named setting or field of your own behind it.");
      }
      break;
    }
    case "partly": {
      if (kept.length === 0) return review("Rated Partly covered without naming the part that is covered.");
      break;
    }
    case "not_covered":
      break;
  }

  // A connector (or anything else) that carries a limitation cannot, on its own,
  // make a row Standard or Needs setup: the limitation is the honest answer.
  if ((raw.rating === "standard" || raw.rating === "needs_setup") && kept.every((e) => e.caveat)) {
    warnings.push(`Lowered to Partly covered: ${kept.map((e) => e.caveat).join(" ")}`);
    confidence = confidence === "sure" ? "likely" : confidence;
    return result("partly", ids);
  }

  return result(raw.rating, ids);
}

export type FitCounts = Record<Rating, number>;

export function countRatings(rows: readonly { rating: Rating }[]): FitCounts {
  const c: FitCounts = { standard: 0, needs_setup: 0, partly: 0, not_covered: 0, needs_review: 0, coming: 0 };
  for (const r of rows) c[r.rating]++;
  return c;
}

/** Rows that need a change: they feed step 4. Needs review counts, because it is unresolved. */
export const needsChange = (r: Rating): boolean => r === "partly" || r === "not_covered" || r === "needs_review" || r === "coming";
