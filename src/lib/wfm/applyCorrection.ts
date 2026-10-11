import type { createAdminSupabase } from "@/lib/supabase-server";
import { resolveProjectForPunch } from "@/lib/wfm/projectServer";
import type { PresenceKind } from "@/lib/wfm/types";

type Admin = ReturnType<typeof createAdminSupabase>;

/**
 * Write a corrected punch and retire the one it replaces.
 *
 * Extracted 2026-10-11 from PATCH /api/wfm/corrections/[id] so that a
 * supervisor correcting an employee's time directly and a supervisor approving
 * an employee's request write a punch the SAME way. They had to: the chain
 * handling below exists because of KAN-28, and a second copy of it would be
 * the next place for that bug to come back.
 *
 * Append-only: nothing is edited. A new event is inserted and the old one is
 * stamped `superseded_by`, which every reader filters on, so the new time
 * replaces the old everywhere it counted.
 */

/**
 * KAN-28. Correcting the same punch twice left BOTH corrections live.
 *
 * A request names the punch that was on screen when it was filed, so a second
 * request filed before the first was approved still names the ORIGINAL.
 * Superseding that original again overwrote its link to the first correction,
 * which was then orphaned -- unsuperseded, and therefore still counted by every
 * reader. So supersede the HEAD of the chain, not the name on the request:
 *   A -> B -> C   (only C live)   instead of   A -> C, B orphaned
 *
 * Bounded rather than `while`: a cycle here would hang the request.
 */
export async function liveHeadOf(admin: Admin, tenantId: string, eventId: string | null): Promise<string | null> {
  let at = eventId;
  for (let hop = 0; hop < 20 && at; hop++) {
    const { data: node } = await admin
      .from("wfm_presence_events").select("superseded_by")
      .eq("id", at).eq("tenant_id", tenantId).maybeSingle();
    const next = (node?.superseded_by as string | null) ?? null;
    if (!next) return at;
    at = next;
  }
  return at;
}

export type ApplyCorrectionInput = {
  tenantId: string;
  employeeId: string;
  kind: PresenceKind;
  /** ISO timestamp the punch should now read. */
  ts: string;
  /** The punch being replaced, or null when the punch is being ADDED. */
  targetEventId: string | null;
  /** YYYY-MM-DD the correction is about, for project resolution. */
  targetDate: string;
  actorUserId: string;
  /** `correction` for an approved employee request; `manual_admin` for a supervisor's own change. */
  source: "correction" | "manual_admin";
  /** Extra provenance stored on the event row (e.g. the request that explains it). */
  flags?: Record<string, unknown>;
  /** Shown if someone else corrected the same punch a moment earlier. */
  conflictMessage: string;
};

export type ApplyCorrectionResult =
  | { ok: true; eventId: string }
  | { ok: false; status: number; error: string };

export async function applyCorrectionEvent(admin: Admin, p: ApplyCorrectionInput): Promise<ApplyCorrectionResult> {
  const supersedeId = await liveHeadOf(admin, p.tenantId, p.targetEventId);

  // Project costing (0104): a corrected punch must carry the same project a
  // real one would, or the hours it repairs land as unassigned. A session takes
  // its project from its OPENING punch (workSessions), so a corrected check-in
  // with no stamp silently unassigned the whole day (wiring audit, 2026-09-06).
  // If the punch being replaced was stamped, that stamp is the truth at punch
  // time and is kept; otherwise resolve for the day the correction is about,
  // from the employee's standing site and shift -- there is no geofence to
  // consult for a punch nobody physically made.
  let projectId: string | null = null;
  if (p.targetEventId) {
    const { data: original } = await admin
      .from("wfm_presence_events").select("project_id")
      .eq("id", p.targetEventId).eq("tenant_id", p.tenantId).maybeSingle();
    projectId = (original?.project_id as string | null) ?? null;
  }
  if (!projectId) {
    const { data: emp } = await admin
      .from("employees").select("site_id, shift_id")
      .eq("id", p.employeeId).eq("tenant_id", p.tenantId).maybeSingle();
    projectId = await resolveProjectForPunch(
      admin, p.tenantId, p.employeeId, p.targetDate,
      (emp?.site_id as string | null) ?? null,
      (emp?.shift_id as string | null) ?? null
    );
  }

  const eventId = crypto.randomUUID();
  const { error: insertErr } = await admin.from("wfm_presence_events").insert({
    id: eventId,
    tenant_id: p.tenantId,
    employee_id: p.employeeId,
    ts: p.ts,
    kind: p.kind,
    source: p.source,
    project_id: projectId,
    created_by: p.actorUserId,
    ...(p.flags ? { flags: p.flags } : {}),
  });
  if (insertErr) return { ok: false, status: 500, error: insertErr.message };

  if (supersedeId) {
    // Guarded on superseded_by being null so a concurrent correction that got
    // there first cannot have its link overwritten; zero rows means the head
    // moved under us, and the event just written is the orphan.
    const { data: superseded, error: supersedeErr } = await admin
      .from("wfm_presence_events")
      .update({ superseded_by: eventId })
      .eq("id", supersedeId)
      .eq("tenant_id", p.tenantId)
      .is("superseded_by", null)
      .select("id");
    if (supersedeErr) return { ok: false, status: 500, error: supersedeErr.message };
    if (!superseded || superseded.length === 0) {
      // Undo our own insert rather than leave a second live punch behind.
      await admin.from("wfm_presence_events").delete().eq("id", eventId).eq("tenant_id", p.tenantId);
      return { ok: false, status: 409, error: p.conflictMessage };
    }
  }

  return { ok: true, eventId };
}
