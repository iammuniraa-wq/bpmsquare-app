import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { getEmployeeLoginEmail, sendWfmNotification } from "@/lib/wfm/notify";
import { ROUTES } from "@/lib/constants";
import { canApproveFor } from "@/lib/wfm/scope";
import { applyCorrectionEvent } from "@/lib/wfm/applyCorrection";
import type { PresenceKind } from "@/lib/wfm/types";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

// PATCH /api/wfm/corrections/[id] — supervisor approves or rejects a
// pending request. Approve never edits the original presence event (if
// any) — it inserts a new source=correction event and stamps
// superseded_by on the old one, per the append-only design (§2).
//
// That pairing is what actually moves the timesheet: every read that
// computes hours filters `.is("superseded_by", null)` (lib/wfm/meState.ts,
// monthlySummary.ts, projectHoursServer.ts, server.ts), so the corrected
// event replaces the original everywhere the original counted -- the
// timesheet, the monthly summary, the CA export and project hours alike.
// Nothing recomputes or caches those figures, so there is no second step.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, userId } = ctx;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const { action, supervisor_remark } = (body ?? {}) as { action?: string; supervisor_remark?: string };
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }
  if (action === "reject" && !supervisor_remark?.trim()) {
    return NextResponse.json({ error: "supervisor_remark is required to reject" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Telling the employee is the whole point of the decision. Until now only
  // the filing was notified (correction_pending, employee -> supervisor);
  // the outcome travelled nowhere, so someone whose pay depended on a
  // mis-punch had to keep opening the app to find out. Fire-and-forget on
  // purpose -- a mail failure must never fail an approval that already
  // wrote its event.
  const notifyEmployee = async (
    employeeId: string,
    targetDate: string,
    outcome: "approved" | "rejected",
    remark: string | null
  ) => {
    const config = await getWfmConfig(admin, tenantId);
    if (!config.notifications.correction_resolved) return;
    const email = await getEmployeeLoginEmail(admin, tenantId, employeeId);
    if (!email) return; // not every employee has a login
    await sendWfmNotification({
      sessionSupabase: ctx.supabase,
      tenantId,
      toEmails: [email],
      subject: `Your correction for ${targetDate} was ${outcome}`,
      text: outcome === "approved"
        ? `Your supervisor approved your attendance correction for ${targetDate}. Your timesheet has been updated.`
          + (remark ? `\n\nNote: "${remark}"` : "")
        : `Your supervisor could not approve your attendance correction for ${targetDate}.`
          + `\n\nReason: "${remark ?? ""}"`,
      link: { path: ROUTES.wfmMe, label: "View your timesheet" },
      relatedObjectType: "wfm_correction_requests",
      relatedObjectId: id,
      relatedObjectLabel: targetDate,
    });
  };

  const { data: req } = await admin
    .from("wfm_correction_requests")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!req) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (req.status !== "pending") {
    return NextResponse.json({ error: "Request has already been resolved" }, { status: 409 });
  }

  // Judged against the day the correction is ABOUT, so a later roster change
  // can't hand the decision to someone who never saw the work.
  const allowed = await canApproveFor(ctx, req.employee_id as string, req.target_date as string);
  if (!allowed.ok) return NextResponse.json({ error: allowed.reason }, { status: 403 });

  if (action === "reject") {
    const { data, error } = await admin
      .from("wfm_correction_requests")
      .update({
        status: "rejected",
        supervisor_id: userId,
        supervisor_remark: supervisor_remark!.trim(),
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Request has already been resolved" }, { status: 409 });
    notifyEmployee(req.employee_id as string, req.target_date as string, "rejected", supervisor_remark!.trim()).catch(() => {});
    return NextResponse.json(data);
  }

  // Approve. requested_change carries {issue, proposed_ts?, kind?} — see
  // wfm/types.ts. "other" issues have no concrete kind/ts to act on; those
  // can only be approved as an administrative note (no event is written).
  const change = (req.requested_change ?? {}) as { issue?: string; proposed_ts?: string; kind?: PresenceKind };

  // Every issue but "other" has to write a real event, or approving it moves
  // nothing on the timesheet while telling the supervisor it worked.
  const NEEDS_EVENT = new Set([
    "missing_check_in", "missing_check_out",
    "missing_break_start", "missing_break_end",
    "wrong_time",
  ]);

  // A wrong_time request filed BEFORE the create route learned to stamp the
  // kind (it only ever mapped the two missing_* issues) has proposed_ts and
  // target_event_id but no kind -- and the write below needs both, so those
  // requests approve to nothing. They are still sitting in queues, so the
  // kind is recovered here the same way the create route now derives it: from
  // the punch being corrected.
  let kind = change.kind;
  if (!kind && req.target_event_id) {
    const { data: target } = await admin
      .from("wfm_presence_events").select("kind")
      .eq("id", req.target_event_id).eq("tenant_id", tenantId).maybeSingle();
    kind = (target?.kind as PresenceKind | undefined) ?? undefined;
  }

  // Fail rather than approve a request that cannot be applied. Silence here
  // is the worst outcome available: the employee sees "approved", the
  // timesheet still shows the wrong time, and nobody has anything to chase.
  if (NEEDS_EVENT.has(change.issue ?? "") && !(kind && change.proposed_ts)) {
    return NextResponse.json({
      error: "This request can't be applied -- it doesn't say which punch to correct. Ask the employee to file it again against the punch itself.",
    }, { status: 409 });
  }

  if (kind && change.proposed_ts) {
    // Writing the corrected punch and retiring the old one lives in
    // lib/wfm/applyCorrection.ts, shared with a supervisor's own direct
    // correction -- including the KAN-28 chain handling, so there is one copy.
    const applied = await applyCorrectionEvent(admin, {
      tenantId,
      employeeId: req.employee_id as string,
      kind,
      ts: change.proposed_ts,
      targetEventId: (req.target_event_id as string | null) ?? null,
      targetDate: req.target_date as string,
      actorUserId: userId,
      source: "correction",
      conflictMessage: "This punch was corrected by someone else a moment ago. Reload the queue and check it before approving again.",
    });
    if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: applied.status });
  }

  // `.eq("status", "pending")` is the gate, not the read at the top of this
  // function. That read-then-write let two approvals of the same request both
  // pass -- a double click, or a retry after the 60s timeout BIM was hitting
  // all through 2026-09-23, when the server had in fact completed the work.
  // Zero rows back means someone else resolved it first.
  const { data, error } = await admin
    .from("wfm_correction_requests")
    .update({
      status: "approved",
      supervisor_id: userId,
      supervisor_remark: supervisor_remark?.trim() || null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: "Request has already been resolved" }, { status: 409 });
  }
  notifyEmployee(req.employee_id as string, req.target_date as string, "approved", supervisor_remark?.trim() || null).catch(() => {});
  return NextResponse.json(data);
}
