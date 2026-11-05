// What the model is shown for one site: the prefetch result of `attendance_site_digest` (design 3.4). Aggregated or
// per-day, aliased, no name / code / id / coordinate / free-text reason anywhere.

import { siteDayRows, type Candidate, type SiteDayRow } from "./detectors";
import type { RuleNote, SiteFacts } from "./facts";

export type SiteDigest = {
  site: SiteFacts["site"];
  run: { from: string; to: string; days: number };
  rule_notes: RuleNote[];
  headcount: { people: number; by_type: Record<string, number> };
  days: SiteDayRow[];
  candidates: Candidate[];
};

export function buildDigest(facts: SiteFacts, candidates: Candidate[]): SiteDigest {
  const byType: Record<string, number> = {};
  for (const p of facts.people) byType[p.type] = (byType[p.type] ?? 0) + 1;
  return {
    site: facts.site,
    run: { from: facts.run.from, to: facts.run.to, days: facts.run.dates.length },
    rule_notes: facts.rule_notes,
    headcount: { people: facts.people.length, by_type: byType },
    days: siteDayRows(facts),
    candidates,
  };
}
