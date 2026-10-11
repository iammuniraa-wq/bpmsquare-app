import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase, getAuthUser } from "@/lib/supabase-server";
import { requireWfmSupervisor, getWfmConfig, dateKeyInTz } from "@/lib/wfm/server";
import { canApproveFor } from "@/lib/wfm/scope";
import { applyCorrectionEvent } from "@/lib/wfm/applyCorrection";
import {
  ADDABLE_KINDS, FUTURE_SLACK_MS, MAX_SHIFT_MS, checkReason, isWithinEditWindow, SUPERVISOR_EDIT_MONTHS,
} from "@/lib/wfm/timeCorrection";
import { getEmployeeLoginEmail, sendWfmNotification } from "@/lib/wfm/notify";
import { logChange } from "@/lib/changeLog";
import { ROUTES } from "@/lib/constants";
import { OT_KINDS, PUNCH_KIND_LABEL, type PresenceKind } from "@/lib/wfm/types";

// Capped per route -- see api/wfm/presence/route.ts for why vercel.json's glob
// does not do this.
export const maxDuration = 60;

// POST /api/wfm/employees/[id]/time-correction
//
// A supervisor changes an employee's time DIRECTLY, with a mandatory
// explanation -- as opposed to the employee filing a correction and a
// supervisor approving it (api/wfm/corrections). Owner request 2026-10-11:
// "a supervisor can open an employee and should have an option to do time
// correction, and explain why the supervisor has updated the time, and log it."
//
// Body: { action: "change" | "add", target_event_id?, kind?, proposed_ts, reason }
//   change -- replace the time of an existing live punch (kind comes from it)
//   add    -- insert a missing punch of one of the four core kinds
//
// Append-only like every other write in this module: a new event is inserted
// and the old one superseded, so nothing is overwritten and the trail survives.
// The explanation and the person who made the change are recorded as an
// already-approved row in wfm_correction_requests, which is what the employee's
// own Corrections history and the supervisor's hub already render -- so the
// employee sees what changed and why with no new screen and no migration.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, userId } = ctx;
  const { id: employeeId } = await params;

  const body = await request.json().catch(() => null) as {
    action?: string; target_event_id?: string; kind?: string; proposed_ts?: string; reason?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { action } = body;
  if (action !== "change" && action !== "add") {
    return NextResponse.json({ error: "action must be 'change' or 'add'" }, { status: 400 });
  }

  const reason = checkReason(body.reason);
  if (!reason.ok) return NextResponse.json({ error: reason.error }, { status: 400 });

  const tsDate = new Date(body.proposed_ts ?? "");
  if (isNaN(tsDate.getTime())) {
    return NextResponse.json({ error: "Give the corrected date and time." }, { status: 400 });
  }
  if (tsDate.getTime() > Date.now() + FUTURE_SLACK_MS) {
    return NextResponse.json({ error: "That time is in the future." }, { status: 400 });
  }

  // Nobody changes their own time, including a tenant admin -- the same
  // separation of duties canApproveFor() applies to approving a request.
  // Checked here as well because canApproveFor's wording ("approve your own
  // request") would read oddly for a direct edit.
  if (ctx.employee && ctx.employee.id === employeeId) {
    return NextResponse.json({ error: "You can't change your own time. Ask another supervisor." }, { status: 403 });
  }

  const admin = createAdminSupabase();

  const { data: emp } = await admin
    .from("employees").select("id, first_name, last_name")
    .eq("id", employeeId).eq("tenant_id", tenantId).maybeSingle();
  if (!emp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = await getWfmConfig(admin, tenantId);
  const todayKey = dateKeyInTz(new Date(), config.timezone);
  const dayKey = dateKeyInTz(tsDate, config.timezone);

  let kind: PresenceKind;
  let targetEventId: string | null = null;
  let originalTs: string | null = null;

  if (action === "change") {
    if (!body.target_event_id) {
      return NextResponse.json({ error: "Pick the punch you want to change." }, { status: 400 });
    }
    // Scoped by employee AND tenant: an event id from another person or another
    // workspace matches nothing (MULTI_TENANT_GUARDRAILS.md, foreign ids).
    const { data: ev } = await admin
      .from("wfm_presence_events").select("id, kind, ts, superseded_by")
      .eq("id", body.target_event_id).eq("tenant_id", tenantId).eq("employee_id", employeeId).maybeSingle();
    if (!ev) return NextResponse.json({ error: "That punch wasn't found for this employee." }, { status: 404 });
    if (ev.superseded_by) {
      return NextResponse.json({
        error: "That punch has already been corrected. Reload the day and look at what it reads now.",
      }, { status: 409 });
    }
    kind = ev.kind as PresenceKind;
    if (OT_KINDS.includes(kind)) {
      return NextResponse.json({
        error: "Overtime punches are handled through overtime approval, not changed here.",
      }, { status: 400 });
    }
    targetEventId = ev.id as string;
    originalTs = ev.ts as string;

    // The punch being changed must itself be inside the window -- otherwise a
    // closed month could be edited by "moving" one of its punches into range.
    if (!isWithinEditWindow(dateKeyInTz(new Date(originalTs), config.timezone), todayKey)) {
      return NextResponse.json({
        error: `That punch is outside the period you can edit (this month and the previous ${SUPERVISOR_EDIT_MONTHS - 1}).`,
      }, { status: 403 });
    }
    if (tsDate.getTime() === new Date(originalTs).getTime()) {
      return NextResponse.json({ error: "That is the time it already has." }, { status: 400 });
    }
    // A typed time a day or more away from the punch it replaces is almost
    // always a wrong date or year.
    if (Math.abs(tsDate.getTime() - new Date(originalTs).getTime()) > MAX_SHIFT_MS) {
      return NextResponse.json({
        error: "That moves the punch by more than a day. Check the date.",
      }, { status: 400 });
    }
  } else {
    if (!ADDABLE_KINDS.includes(body.kind as (typeof ADDABLE_KINDS)[number])) {
      return NextResponse.json({
        error: "You can add check in, check out, break start or break end.",
      }, { status: 400 });
    }
    kind = body.kind as PresenceKind;

    // An identical live punch is a double submit, not a second shift: two real
    // punches of one kind never share a timestamp to the second. (A genuine
    // second check-in -- someone who signed out and came back -- is a different
    // time and is allowed; employees can legitimately have two in a day.)
    const { data: dup } = await admin
      .from("wfm_presence_events").select("id")
      .eq("tenant_id", tenantId).eq("employee_id", employeeId).eq("kind", kind)
      .eq("ts", tsDate.toISOString()).is("superseded_by", null).limit(1);
    if (dup && dup.length > 0) {
      return NextResponse.json({ error: "That punch is already recorded at that time." }, { status: 409 });
    }
  }

  if (!isWithinEditWindow(dayKey, todayKey)) {
    return NextResponse.json({
      error: `You can only edit this month and the previous ${SUPERVISOR_EDIT_MONTHS - 1}. That date is outside it.`,
    }, { status: 403 });
  }

  // Judged against the day the change is about, same rule as approving.
  const allowed = await canApproveFor(ctx, employeeId, dayKey);
  if (!allowed.ok) return NextResponse.json({ error: allowed.reason }, { status: 403 });

  // The record first, then the punch. If the punch then fails the record is
  // removed, so the log never claims a change that did not happen. The other
  // order risks the worse failure: a changed punch with no explanation behind
  // it, which is exactly what this feature exists to prevent.
  const issue = action === "change" ? "wrong_time" : (`missing_${kind}` as const);
  const { data: record, error: recErr } = await admin
    .from("wfm_correction_requests")
    .insert({
      tenant_id: tenantId,
      employee_id: employeeId,
      target_date: dayKey,
      target_event_id: targetEventId,
      requested_change: { issue, proposed_ts: tsDate.toISOString(), kind, by: "supervisor" },
      // reason_text is the employee's side of a normal request and NOT NULL;
      // the supervisor's explanation goes in supervisor_remark, which the hub
      // and the employee's own screen already show under the status.
      reason_text: "Time corrected by supervisor",
      status: "approved",
      supervisor_id: userId,
      supervisor_remark: reason.value,
      resolved_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (recErr || !record) {
    return NextResponse.json({ error: recErr?.message ?? "Could not record the correction" }, { status: 500 });
  }

  const applied = await applyCorrectionEvent(admin, {
    tenantId,
    employeeId,
    kind,
    ts: tsDate.toISOString(),
    targetEventId,
    targetDate: dayKey,
    actorUserId: userId,
    source: "manual_admin",
    flags: { correction_request_id: record.id, by: "supervisor" },
    conflictMessage: "Someone corrected that punch a moment ago. Reload the day and check it before changing it again.",
  });
  if (!applied.ok) {
    const { error: cleanupErr } = await admin
      .from("wfm_correction_requests").delete().eq("id", record.id).eq("tenant_id", tenantId);
    // If this fails too, an approved record exists for a change that did not
    // happen -- the log would then claim something untrue, so say so loudly.
    if (cleanupErr) console.error(`time-correction: could not remove record ${record.id} after a failed write: ${cleanupErr.message}`);
    return NextResponse.json({ error: applied.error }, { status: applied.status });
  }

  // Link the record to the event it produced. A request has no column for that
  // (0062_wfm_module.sql), which is what made the KAN-28 backfill so hard to
  // build; here it is known, so keep it. Best-effort -- the record stands
  // without it.
  await admin
    .from("wfm_correction_requests")
    .update({ requested_change: { issue, proposed_ts: tsDate.toISOString(), kind, by: "supervisor", event_id: applied.eventId } })
    .eq("id", record.id).eq("tenant_id", tenantId);

  const empName = [emp.first_name, emp.last_name].filter(Boolean).join(" ");
  const user = await getAuthUser();
  await logChange(ctx.supabase, {
    tenantId,
    objectType: "employees",
    objectId: employeeId,
    objectLabel: empName,
    action: "update",
    actorId: userId,
    actorEmail: user?.email ?? null,
    changes: [
      { field: `${PUNCH_KIND_LABEL[kind]} (${dayKey})`, from: originalTs, to: tsDate.toISOString() },
      { field: "reason", from: null, to: reason.value },
    ],
  });

  // Tell the employee, same switch as an approved/rejected correction.
  // Fire-and-forget: a mail failure must never undo a change that is written.
  if (config.notifications.correction_resolved) {
    const when = new Intl.DateTimeFormat("en-IN", {
      timeZone: config.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(tsDate);
    (async () => {
      const email = await getEmployeeLoginEmail(admin, tenantId, employeeId);
      if (!email) return;
      await sendWfmNotification({
        sessionSupabase: ctx.supabase,
        tenantId,
        toEmails: [email],
        subject: `Your supervisor corrected your time for ${dayKey}`,
        text: `Your supervisor changed your attendance for ${dayKey}: ${PUNCH_KIND_LABEL[kind]} is now ${when}.\n\nReason: "${reason.value}"`,
        link: { path: ROUTES.wfmMe, label: "View your timesheet" },
        relatedObjectType: "wfm_correction_requests",
        relatedObjectId: record.id as string,
        relatedObjectLabel: dayKey,
      });
    })().catch(() => {});
  }

  return NextResponse.json({ request_id: record.id, event_id: applied.eventId });
}
