import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, requireWfmEmployee, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getSupervisorEmails, sendWfmNotification, wfmUrl } from "@/lib/wfm/notify";
import { ROUTES } from "@/lib/constants";
import type { CorrectionIssue, PresenceKind } from "@/lib/wfm/types";

const ISSUES: CorrectionIssue[] = ["missing_check_in", "missing_check_out", "wrong_time", "other"];
const ISSUE_KIND: Partial<Record<CorrectionIssue, PresenceKind>> = {
  missing_check_in: "check_in",
  missing_check_out: "check_out",
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/wfm/corrections — supervisors see the tenant queue (optionally
// ?status=pending); everyone else sees only their own requests.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId, employee, isSupervisor } = ctx;
  const status = request.nextUrl.searchParams.get("status");
  const employeeIdParam = request.nextUrl.searchParams.get("employee_id");

  let query = supabase
    .from("wfm_correction_requests")
    .select(
      isSupervisor
        ? "*, employees(first_name, last_name, employee_code)"
        : "*"
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (!isSupervisor) {
    if (!employee) return NextResponse.json({ error: "No employee profile" }, { status: 403 });
    query = query.eq("employee_id", employee.id);
  } else {
    // A supervisor's queue is their own subtree, not the whole tenant: the
    // site(s) they run plus anything under supervisors reporting to them.
    const scope = await resolveWfmScope(ctx);
    if (!scope.unrestricted) query = query.in("employee_id", scope.employeeIds ?? []);
    if (employeeIdParam) query = query.eq("employee_id", employeeIdParam);
  }
  if (status === "pending" || status === "approved" || status === "rejected") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/corrections — an employee requests a correction to their
// own attendance. Never writes/edits a presence event itself (see §2) —
// only a supervisor approval does that, via PATCH .../corrections/[id].
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, employee } = ctx;

  const body = await request.json().catch(() => null);
  const { target_date, issue, proposed_ts, target_event_id, reason_text, recheck_request_id } = (body ?? {}) as {
    target_date?: string; issue?: string; proposed_ts?: string;
    target_event_id?: string; reason_text?: string; recheck_request_id?: string;
  };

  if (!target_date || !DATE_RE.test(target_date)) {
    return NextResponse.json({ error: "target_date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  if (!issue || !ISSUES.includes(issue as CorrectionIssue)) {
    return NextResponse.json({ error: "Invalid issue" }, { status: 400 });
  }
  if (!reason_text?.trim()) {
    return NextResponse.json({ error: "reason_text is required" }, { status: 400 });
  }
  const kind = ISSUE_KIND[issue as CorrectionIssue];
  if ((issue === "missing_check_in" || issue === "missing_check_out") && !proposed_ts) {
    return NextResponse.json({ error: "proposed_ts is required for this issue type" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // A referenced event (wrong_time) must belong to this employee/tenant.
  let verifiedEventId: string | null = null;
  if (target_event_id) {
    const { data: event } = await admin
      .from("wfm_presence_events")
      .select("id")
      .eq("id", target_event_id)
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: "Unknown event" }, { status: 400 });
    verifiedEventId = event.id;
  }

  const { data, error } = await admin
    .from("wfm_correction_requests")
    .insert({
      tenant_id: tenantId,
      employee_id: employee.id,
      target_date,
      target_event_id: verifiedEventId,
      requested_change: { issue, proposed_ts: proposed_ts || undefined, kind },
      reason_text: reason_text.trim(),
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If this correction was filed in response to a supervisor's recheck
  // flag, link the two so a supervisor reviewing the recheck can jump
  // straight to the fix the employee actually filed.
  if (recheck_request_id) {
    await admin
      .from("wfm_recheck_requests")
      .update({ linked_correction_id: data.id })
      .eq("id", recheck_request_id)
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id);
  }

  const config = await getWfmConfig(admin, tenantId);
  if (config.notifications.correction_pending) {
    const empName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");
    const emails = await getSupervisorEmails(admin, tenantId, employee.id);
    sendWfmNotification({
      sessionSupabase: ctx.supabase,
      tenantId,
      toEmails: emails,
      subject: `Correction request from ${empName} — ${target_date}`,
      text: `${empName} has requested a correction to their attendance on ${target_date}.\n\nReason: ${reason_text.trim()}\n\nReview it here: ${wfmUrl(ROUTES.wfmCorrections)}`,
      relatedObjectType: "wfm_correction_requests",
      relatedObjectId: data.id,
      relatedObjectLabel: `${empName} — ${target_date}`,
    }).catch(() => {});
  }

  return NextResponse.json(data);
}
