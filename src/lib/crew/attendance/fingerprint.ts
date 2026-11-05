// Fingerprints for dedupe (design 3.10): kind | subject | the one key-fact bucket. Built from REAL ids (resolved from the run's
// alias map, because aliases are per run and would never match twice), and stored only server-side. A worse situation falls
// into a higher bucket and is therefore a NEW finding, which is how "suppressed for 30 days unless it worsens" works.

import { createHash } from "node:crypto";
import type { AliasMap } from "./alias";
import type { Candidate } from "./detectors";
import type { RenderedFinding } from "./validate";

/** Coarse buckets, so one more late mark does not re-open a dismissed finding but a doubling does. */
export function countBucket(n: number): string {
  if (n <= 2) return "1-2";
  if (n <= 4) return "3-4";
  if (n <= 7) return "5-7";
  if (n <= 12) return "8-12";
  return "13+";
}

export type FingerprintCtx = { aliases: AliasMap };

export function fingerprintFinding(f: Pick<RenderedFinding, "kind" | "level" | "subject">, c: Candidate, ctx: FingerprintCtx): string | null {
  const siteId = ctx.aliases.sites[c.site];
  if (!siteId) return null;
  let subject: string;
  if (f.level === "person") {
    const personId = f.subject.alias ? ctx.aliases.persons[f.subject.alias] : undefined;
    if (!personId) return null;
    subject = `person:${personId}`;
  } else {
    subject = `site:${siteId}`;
  }
  const keyFact = f.level === "person" ? countBucket(c.count) : `${countBucket(c.people_affected)}|${c.days.length >= 3 ? "3+d" : `${c.days.length}d`}`;
  const raw = ["attendance", f.kind, f.level, siteId, subject, keyFact].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/** Proposal fingerprint: the action, the finding's fingerprint and the sorted real targets. */
export function fingerprintProposal(action: string, findingFingerprint: string, targetAliases: string[], ctx: FingerprintCtx): string | null {
  const ids: string[] = [];
  for (const a of targetAliases) {
    const id = ctx.aliases.persons[a];
    if (!id) return null;
    ids.push(id);
  }
  const raw = ["attendance", action, findingFingerprint, ...ids.sort()].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}
