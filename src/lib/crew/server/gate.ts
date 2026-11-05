import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logChange } from "@/lib/changeLog";
import { runVia } from "@/lib/actions/via";
import { PROPOSAL_SUPPRESS_DAYS } from "../core/fingerprint";
import { cleanNote, executeNudge } from "../tender/nudge";
import type { ActionKey, Proposal } from "../types";
import { executeRecheck, recheckWordingProblem } from "./recheck";
import { loadProposal } from "./store";

// The approval gate (docs/design/nova-crew-agents.md section 3.5). Nothing executes except by a person's press, and the press is checked in
// this order, mirroring src/lib/actions/execute.ts:
//  1. the person is in approver_ids (the finding's recipients, fixed when the proposal was made);
//  2. the proposal is pending and not expired; the row is claimed pending -> approved by compare-and-set, so a second press finds it changed;
//  3. the target is re-validated and the permission is re-checked NOW (the executor opens the object's own door on the person's session);
//  4. the person's edit replaces the draft (the diff is kept in edited_payload and in Change History);
//  5. the action runs inside runVia("crew"); done / failed + result; the finding becomes actioned.
// A rejection needs one tap and an optional note, and silences the same note for PROPOSAL_SUPPRESS_DAYS days.

type ActionOutcome = { ok: true; result: Record<string, unknown> } | { ok: false; status: number; error: string; expire?: boolean };
type Executor = (p: Proposal, message: string, opts: { targets?: string[] }) => Promise<ActionOutcome>;

/**
 * The closed registry. Both actions reach a person only as a note a human edited and sent. `wfm.recheck` re-checks the employee is in the approver's
 * scope for that day (the recheck route itself does not), skips anyone who is not, and is sent as the supervisor's own message.
 */
const EXECUTORS: Partial<Record<ActionKey, Executor>> = {
  "tender.nudge": executeNudge,
  "wfm.recheck": executeRecheck,
};

/** Checks that must pass BEFORE the press is claimed, so a fixable problem does not use up the proposal. Null = fine. */
const PRECHECKS: Partial<Record<ActionKey, (message: string) => string | null>> = {
  "wfm.recheck": recheckWordingProblem,
};

export type DecideInput = {
  admin: SupabaseClient;
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  userEmail: string | null;
  proposalId: string;
  action: "approve" | "reject";
  message?: unknown;
  /** wfm.recheck: the employee ids to keep (the approver may leave people out, never add). */
  targets?: unknown;
  note?: string | null;
};

export type DecideResult = { ok: true; status: "done" | "rejected"; result?: Record<string, unknown> } | { ok: false; status: number; error: string };

export async function decideProposal(i: DecideInput): Promise<DecideResult> {
  const { admin, tenantId, userId } = i;
  const p = await loadProposal(admin, tenantId, i.proposalId);
  if (!p || !p.approver_ids.includes(userId)) return { ok: false, status: 404, error: "Not found" };
  if (p.status !== "pending") return { ok: false, status: 409, error: "This note was already handled." };
  const now = new Date();
  if (Date.parse(p.expires_at) < now.getTime()) {
    await admin.from("crew_proposals").update({ status: "expired", decision_note: "Not answered in time" }).eq("id", p.id).eq("tenant_id", tenantId).eq("status", "pending");
    return { ok: false, status: 410, error: "This note expired before it was answered." };
  }

  const label = String((p.payload as { label?: unknown }).label ?? p.target_id);

  if (i.action === "reject") {
    const { data } = await admin.from("crew_proposals").update({ status: "rejected", decided_by: userId, decided_at: now.toISOString(), decision_note: i.note?.slice(0, 300) ?? null })
      .eq("id", p.id).eq("tenant_id", tenantId).eq("status", "pending").select("id");
    if ((data ?? []).length === 0) return { ok: false, status: 409, error: "This note was already handled." };
    await logChange(i.supabase, { tenantId, objectType: "crew_proposal", objectId: p.id, objectLabel: label, action: "update", actorId: userId, actorEmail: i.userEmail, changes: [{ field: "Proposed note", from: "pending", to: `rejected (silenced ${PROPOSAL_SUPPRESS_DAYS} days)` }] });
    return { ok: true, status: "rejected" };
  }

  const exec = EXECUTORS[p.action_key];
  if (!exec) return { ok: false, status: 501, error: "This action is not available yet." };
  const draft = String((p.payload as { message?: unknown }).message ?? "");
  const message = cleanNote(i.message === undefined ? draft : i.message);
  if (!message) return { ok: false, status: 400, error: "Write the note first." };
  const problem = PRECHECKS[p.action_key]?.(message);
  if (problem) return { ok: false, status: 422, error: problem };
  const planned = Array.isArray((p.payload as { employee_ids?: unknown }).employee_ids) ? ((p.payload as { employee_ids: string[] }).employee_ids) : [];
  const targets = Array.isArray(i.targets) ? i.targets.filter((x): x is string => typeof x === "string" && planned.includes(x)) : undefined;
  if (Array.isArray(i.targets) && (targets ?? []).length === 0) return { ok: false, status: 400, error: "Pick at least one person." };

  // Claim before acting: a second press, or a second tab, finds the row changed and sends nothing.
  const claim = await admin.from("crew_proposals").update({
    status: "approved", decided_by: userId, decided_at: now.toISOString(), edited_payload: message === draft && (!targets || targets.length === planned.length) ? null : { message, ...(targets ? { targets } : {}) },
  }).eq("id", p.id).eq("tenant_id", tenantId).eq("status", "pending").gt("expires_at", now.toISOString()).select("id");
  if ((claim.data ?? []).length === 0) return { ok: false, status: 409, error: "This note was already handled." };

  let out: ActionOutcome;
  try {
    out = await runVia("crew", () => exec(p, message, { targets }));
  } catch (e) {
    console.error("[crew] action failed", (e as Error).message);
    out = { ok: false, status: 500, error: "The note could not be sent." };
  }

  if (!out.ok) {
    await admin.from("crew_proposals").update({ status: out.expire ? "expired" : "failed", result: { error: out.error }, decision_note: out.error.slice(0, 300) }).eq("id", p.id).eq("tenant_id", tenantId);
    return { ok: false, status: out.status, error: out.error };
  }
  await admin.from("crew_proposals").update({ status: "done", executed_at: new Date().toISOString(), result: out.result }).eq("id", p.id).eq("tenant_id", tenantId);
  if (p.finding_id) await admin.from("crew_findings").update({ status: "actioned", status_by: userId, status_at: new Date().toISOString() }).eq("id", p.finding_id).eq("tenant_id", tenantId).in("status", ["open", "seen"]);
  await logChange(i.supabase, {
    tenantId, objectType: "crew_proposal", objectId: p.id, objectLabel: label, action: "update", actorId: userId, actorEmail: i.userEmail, via: "crew",
    changes: message === draft ? [{ field: "Note sent", from: null, to: message }] : [{ field: "Note sent (edited)", from: draft, to: message }],
  });
  return { ok: true, status: "done", result: out.result };
}
