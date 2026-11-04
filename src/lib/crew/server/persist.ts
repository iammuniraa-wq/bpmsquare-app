import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDaysIso, findingFingerprint, proposalFingerprint, purgeAfter, PROPOSAL_SUPPRESS_DAYS, SUPPRESS_DAYS } from "../core/fingerprint";
import type { ValidatedFinding } from "../core/grounding";
import type { RunRow } from "./store";

// Turns validated findings into rows (docs/design/nova-crew-agents.md sections 3.5 and 3.10). All inserts happen at the END of a run,
// in one pass with fingerprints, so a re-run after a crash cannot double anything. Every query is tenant-scoped.

export const NUDGE_CAP_PER_PERSON_PER_DAY = 3;
export const NUDGE_QUIET_HOURS = 48;
export const MAX_NUDGE_LIFE_DAYS = 3;

export type PersistEnv = {
  tenantId: string;
  run: Pick<RunRow, "id" | "agent_key">;
  now: Date;
  /** Workspace-local day (yyyy-mm-dd), for suppress_until and purge_after. */
  today: string;
  retentionDays: number;
  bucketOf: (kind: string, subjectId: string) => string;
  /** Who sees the finding and may approve a note about it. */
  seenBy: (subjectId: string) => string[];
  /** Reduce note recipients to workspace members. */
  members: (ids: string[]) => Promise<string[]>;
  /** The bid end date of the subject, if any: a note expires at the earlier of 3 days or this. */
  closesAt: (subjectId: string) => string | null;
  labelOf: (subjectId: string) => string;
};

export type PersistResult = { created: number; refreshed: number; suppressed: number; proposals: number; skipped: { reason: string }[] };

export async function persistFindings(admin: SupabaseClient, env: PersistEnv, findings: readonly ValidatedFinding[]): Promise<PersistResult> {
  const out: PersistResult = { created: 0, refreshed: 0, suppressed: 0, proposals: 0, skipped: [] };
  const { tenantId, run } = env;
  const nowIso = env.now.toISOString();

  for (const f of findings) {
    const fp = findingFingerprint(run.agent_key, f.kind, f.subject_id, env.bucketOf(f.kind, f.subject_id));

    const sup = await admin.from("crew_findings").select("id").eq("tenant_id", tenantId).eq("fingerprint", fp).in("status", ["dismissed", "not_an_issue"]).gte("suppress_until", env.today).limit(1);
    if ((sup.data ?? []).length > 0) { out.suppressed++; out.skipped.push({ reason: `suppressed: ${f.kind} was dismissed recently and has not got worse` }); continue; }

    let findingId: string | null = null;
    const open = await admin.from("crew_findings").select("id").eq("tenant_id", tenantId).eq("fingerprint", fp).in("status", ["open", "seen"]).limit(1);
    const existing = ((open.data ?? [])[0] as { id: string } | undefined)?.id ?? null;
    if (existing) {
      await admin.from("crew_findings").update({ last_seen_at: nowIso }).eq("id", existing).eq("tenant_id", tenantId);
      findingId = existing;
      out.refreshed++;
    } else {
      const ins = await admin.from("crew_findings").insert({
        tenant_id: tenantId, run_id: run.id, agent_key: run.agent_key, kind: f.kind, severity: f.severity, subject_type: f.subject_type, subject_id: f.subject_id,
        title: f.title, body: f.body, evidence: f.evidence, gaps: f.gaps, fingerprint: fp, recipient_ids: env.seenBy(f.subject_id), status: "open",
        last_seen_at: nowIso, purge_after: purgeAfter(env.today, env.retentionDays),
      }).select("id").single();
      if (ins.error) {
        if (ins.error.code === "23505") { out.refreshed++; continue; }
        out.skipped.push({ reason: `could not be saved: ${ins.error.message.slice(0, 80)}` });
        continue;
      }
      findingId = (ins.data as { id: string }).id;
      out.created++;
    }

    if (f.proposal && findingId) {
      const made = await createProposal(admin, env, findingId, f);
      if (made === "created") out.proposals++;
      else if (made !== "exists") out.skipped.push({ reason: `note not proposed: ${made}` });
    }
  }
  return out;
}

async function createProposal(admin: SupabaseClient, env: PersistEnv, findingId: string, f: ValidatedFinding): Promise<"created" | "exists" | string> {
  const p = f.proposal!;
  const { tenantId, run } = env;
  const recipients = await env.members(p.recipient_ids);
  if (recipients.length === 0) return "no recipient is a member of this workspace";
  const fp = proposalFingerprint(p.action_key, p.target_id, recipients);

  const since = new Date(env.now.getTime() - PROPOSAL_SUPPRESS_DAYS * 86_400_000).toISOString();
  const rej = await admin.from("crew_proposals").select("id").eq("tenant_id", tenantId).eq("fingerprint", fp).eq("status", "rejected").gte("decided_at", since).limit(1);
  if ((rej.data ?? []).length > 0) return "the same note was rejected recently";

  const recent = await admin.from("crew_proposals").select("target_id, status, payload, created_at").eq("tenant_id", tenantId).eq("agent_key", run.agent_key)
    .in("status", ["pending", "approved", "done"]).gte("created_at", new Date(env.now.getTime() - NUDGE_QUIET_HOURS * 3_600_000).toISOString()).limit(500);
  const rows = (recent.data ?? []) as { target_id: string; payload: { recipient_ids?: string[] }; created_at: string }[];
  const sameDeal = new Set(rows.filter((r) => r.target_id === p.target_id).flatMap((r) => r.payload?.recipient_ids ?? []));
  const dayAgo = env.now.getTime() - 86_400_000;
  const perPerson = new Map<string, number>();
  for (const r of rows) if (Date.parse(r.created_at) >= dayAgo) for (const id of r.payload?.recipient_ids ?? []) perPerson.set(id, (perPerson.get(id) ?? 0) + 1);
  const allowed = recipients.filter((id) => !sameDeal.has(id) && (perPerson.get(id) ?? 0) < NUDGE_CAP_PER_PERSON_PER_DAY);
  if (allowed.length === 0) return "a note about this tender already went to that person, or they have reached today's limit";

  const closes = env.closesAt(p.target_id);
  const cap = env.now.getTime() + MAX_NUDGE_LIFE_DAYS * 86_400_000;
  const expires = new Date(Math.min(cap, closes && Number.isFinite(Date.parse(closes)) ? Date.parse(closes) : cap));

  const ins = await admin.from("crew_proposals").insert({
    tenant_id: tenantId, finding_id: findingId, run_id: run.id, agent_key: run.agent_key, action_key: p.action_key, target_type: p.target_type, target_id: p.target_id,
    payload: { recipient_ids: allowed, message: p.message, label: env.labelOf(p.target_id), finding_title: f.title },
    status: "pending", approver_ids: env.seenBy(p.target_id), fingerprint: fp, expires_at: expires.toISOString(),
  });
  if (ins.error) return ins.error.code === "23505" ? "exists" : ins.error.message.slice(0, 80);
  return "created";
}

export { addDaysIso, SUPPRESS_DAYS };

/** Moves a finding to a person's choice. Dismiss and Not an issue silence its fingerprint (the key fact is IN the fingerprint, so a worse situation is a new finding). */
export async function setFindingState(
  admin: SupabaseClient, tenantId: string, id: string, userId: string, status: "seen" | "dismissed" | "not_an_issue" | "actioned", today: string, note?: string | null,
): Promise<boolean> {
  const suppress = status === "dismissed" || status === "not_an_issue" ? addDaysIso(today, status === "not_an_issue" ? SUPPRESS_DAYS : 0) : null;
  const { data, error } = await admin.from("crew_findings").update({
    status, status_by: userId, status_at: new Date().toISOString(), status_note: note?.slice(0, 300) ?? null, suppress_until: suppress,
  }).eq("id", id).eq("tenant_id", tenantId).in("status", ["open", "seen"]).select("id");
  return !error && (data ?? []).length > 0;
}
