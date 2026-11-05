// The step between the model's raw submit_findings and what the runner persists (docs/design/nova-crew-agents.md sections 2 and 5.5). Pure: the production
// runner, the evaluation harness and the tests all go through this one function, so a rule means the same thing in all three.
//
//   raw -> parseSubmission (strict shape) -> validateSubmission (grounding, wording, person-only-when-supported) -> toPersisted (real ids from the run's
//   alias map, fingerprints) -> ValidatedFinding[] (the shape the shared runner and persist already know)
//
// Decisions recorded here:
//  - a `site_note` proposal is not a second action: its text is added to the finding as "Note for the site team", because the people it would address
//    are the very supervisors who already see the finding. Nothing is sent, so no executor and no extra approval exist for it.
//  - a `wfm.recheck` proposal keeps the people to recheck (real ids) and the day in its payload; it is addressed to the same supervisors as the finding.

import type { StepOutputs, ValidatedFinding } from "../core/grounding";
import type { AliasMap } from "./alias";
import type { SiteDigest } from "./digest";
import { toPersisted } from "./leadBridge";
import { parseSubmission } from "./submission";
import { validateSubmission, type ValidationResult } from "./validate";

export type SubmitCtx = {
  digest: SiteDigest;
  aliases: AliasMap;
  /** Login user ids addressed by a finding about this subject (the site's chain of command; never the subject themself). Computed in code. */
  recipientsFor: (subjectType: "employee" | "site", subjectId: string) => string[];
  /** Filled for the Review card's site strip: fingerprint -> the days the pattern is made of. Saved on the run's snapshot. */
  marked?: Record<string, string[]>;
};

export type SubmitOutcome = {
  accepted: ValidatedFinding[];
  rejected: { index: number; reason: string }[];
  /** Null when the submission did not parse. */
  result: ValidationResult | null;
};

export function validateAttendanceSubmission(raw: unknown, steps: StepOutputs, ctx: SubmitCtx): SubmitOutcome {
  const parsed = parseSubmission(raw);
  if (!parsed.ok) return { accepted: [], rejected: [{ index: 0, reason: `malformed: ${parsed.errors.slice(0, 3).join("; ")}` }], result: null };

  const result = validateSubmission(parsed.value, Object.fromEntries(steps));
  const rejected = result.dropped.filter((d) => d.kind === "finding").map((d) => ({ index: d.index, reason: d.reasons.join(", ") }));
  const persisted = toPersisted(result, ctx.digest, ctx.aliases);

  const accepted: ValidatedFinding[] = [];
  const seen = new Set<string>();
  persisted.findings.forEach((p, at) => {
    const rendered = result.findings.find((f) => f.candidate_id === p.candidate_id);
    if (!rendered) return;
    seen.add(p.candidate_id);
    const subjectType = p.subject_type === "employee" ? "employee" : "site";
    const recipients = ctx.recipientsFor(subjectType, p.subject_id);
    const prop = persisted.proposals.find((x) => x.finding_index === at);
    const note = persisted.unmapped.find((x) => x.finding_index === at);
    if (ctx.marked) ctx.marked[p.fingerprint] = ctx.digest.candidates.find((c) => c.id === p.candidate_id)?.days ?? [];
    accepted.push({
      kind: p.kind, severity: p.severity, subject_type: p.subject_type, subject_id: p.subject_id,
      title: p.title, body: note ? `${p.body}\nNote for the site team: ${note.message}` : p.body,
      evidence: p.evidence, gaps: p.gaps, fingerprint: p.fingerprint, site_id: p.site_id, recipient_ids: recipients,
      proposal: prop
        ? { action_key: "wfm.recheck", target_type: prop.target_type, target_id: prop.target_id, recipient_ids: recipients, message: String(prop.payload.message ?? ""), payload: prop.payload, fingerprint: prop.fingerprint }
        : null,
    });
  });
  // Validated but not mappable to a real person or site (an alias with no id behind it): never persisted half-resolved, and said so.
  for (const f of result.findings) if (!seen.has(f.candidate_id)) rejected.push({ index: f.index, reason: "could not be matched to a person or site of this run" });
  return { accepted, rejected, result };
}
