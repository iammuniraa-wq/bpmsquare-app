// Idempotency and suppression (docs/design/nova-crew-agents.md section 3.10). A finding's fingerprint is
// kind | subject | the one key fact bucket, so a WORSE situation is a NEW finding while the same situation is never raised twice.

import { createHash } from "node:crypto";

export const SUPPRESS_DAYS = 30;
export const PROPOSAL_SUPPRESS_DAYS = 14;

export function fingerprint(parts: readonly (string | number | null | undefined)[]): string {
  return createHash("sha256").update(parts.map((p) => String(p ?? "-")).join("|")).digest("hex").slice(0, 32);
}

export const findingFingerprint = (agent: string, kind: string, subjectId: string, bucket: string): string => fingerprint([agent, kind, subjectId, bucket]);

export const proposalFingerprint = (action: string, targetId: string, recipients: readonly string[]): string => fingerprint([action, targetId, [...recipients].sort().join(",")]);

export function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** purge_after for a run or finding created on `day`. */
export const purgeAfter = (day: string, retentionDays: number): string => addDaysIso(day, retentionDays);
