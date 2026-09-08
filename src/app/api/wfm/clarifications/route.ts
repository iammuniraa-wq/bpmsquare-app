import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getSupervisorEmails, getEmployeeLoginEmail, sendWfmNotification } from "@/lib/wfm/notify";
import { ROUTES } from "@/lib/constants";
import { PUNCH_KIND_LABEL, type ClarificationAnchorType, type PresenceKind } from "@/lib/wfm/types";

const ANCHOR_TYPES: ClarificationAnchorType[] = ["general", "punch", "correction", "ot_session"];
const STATUSES = ["open", "resolved"] as const;

// GET /api/wfm/clarifications — every thread (any anchor type) in ONE list,
// newest-active first. Supervisors see their subtree's queue (optionally
// ?status=/?employee_id=); everyone else sees only their own.
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
    .from("wfm_clarification_threads")
    .select(isSupervisor ? "*, employees(first_name, last_name, employee_code)" : "*")
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });

  if (!isSupervisor) {
    if (!employee) return NextResponse.json({ error: "No employee profile" }, { status: 403 });
    query = query.eq("employee_id", employee.id);
  } else {
    const scope = await resolveWfmScope(ctx);
    if (!scope.unrestricted) query = query.in("employee_id", scope.employeeIds ?? []);
    if (employeeIdParam) query = query.eq("employee_id", employeeIdParam);
  }
  if (status && (STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/clarifications — start a new thread with its first message.
// Either side can start one: an employee about their own attendance, or a
// supervisor about someone in their subtree (employee_id required then).
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId, userId, employee, isSupervisor } = ctx;

  const body = await request.json().catch(() => null);
  const {
    anchor_type, target_event_id, target_correction_id, target_ot_session_id,
    subject, body: messageBody, employee_id: bodyEmployeeId,
  } = (body ?? {}) as {
    anchor_type?: string; target_event_id?: string; target_correction_id?: string;
    target_ot_session_id?: string; subject?: string; body?: string; employee_id?: string;
  };

  if (!anchor_type || !ANCHOR_TYPES.includes(anchor_type as ClarificationAnchorType)) {
    return NextResponse.json({ error: "Invalid anchor_type" }, { status: 400 });
  }
  if (!messageBody?.trim()) {
    return NextResponse.json({ error: "A message is required to start a thread" }, { status: 400 });
  }

  // Whose attendance this is about: a plain employee can only ever mean
  // themselves (a client-supplied employee_id is ignored, same rule as every
  // other WFM self-service POST); a supervisor must name one, and only from
  // their own subtree.
  let targetEmployeeId: string;
  if (!isSupervisor) {
    if (!employee) return NextResponse.json({ error: "No employee profile" }, { status: 403 });
    targetEmployeeId = employee.id;
  } else {
    if (!bodyEmployeeId) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
    const scope = await resolveWfmScope(ctx);
    if (!scope.unrestricted && !(scope.employeeIds ?? []).includes(bodyEmployeeId)) {
      return NextResponse.json({ error: "That employee doesn't work at a site you supervise." }, { status: 403 });
    }
    targetEmployeeId = bodyEmployeeId;
  }

  const admin = createAdminSupabase();
  let autoSubject = subject?.trim() || "";

  if (anchor_type === "punch") {
    if (!target_event_id) return NextResponse.json({ error: "target_event_id is required" }, { status: 400 });
    const { data: event } = await admin
      .from("wfm_presence_events").select("id, kind, ts")
      .eq("id", target_event_id).eq("tenant_id", tenantId).eq("employee_id", targetEmployeeId).maybeSingle();
    if (!event) return NextResponse.json({ error: "Unknown punch" }, { status: 400 });
    if (!autoSubject) autoSubject = `${PUNCH_KIND_LABEL[event.kind as PresenceKind]} — ${(event.ts as string).slice(0, 16).replace("T", " ")}`;
  } else if (anchor_type === "correction") {
    if (!target_correction_id) return NextResponse.json({ error: "target_correction_id is required" }, { status: 400 });
    const { data: corr } = await admin
      .from("wfm_correction_requests").select("id, target_date")
      .eq("id", target_correction_id).eq("tenant_id", tenantId).eq("employee_id", targetEmployeeId).maybeSingle();
    if (!corr) return NextResponse.json({ error: "Unknown correction request" }, { status: 400 });
    if (!autoSubject) autoSubject = `Correction — ${corr.target_date}`;
  } else if (anchor_type === "ot_session") {
    if (!target_ot_session_id) return NextResponse.json({ error: "target_ot_session_id is required" }, { status: 400 });
    const { data: ot } = await admin
      .from("wfm_ot_sessions").select("id, ot_date")
      .eq("id", target_ot_session_id).eq("tenant_id", tenantId).eq("employee_id", targetEmployeeId).maybeSingle();
    if (!ot) return NextResponse.json({ error: "Unknown OT session" }, { status: 400 });
    if (!autoSubject) autoSubject = `OT session — ${ot.ot_date}`;
  } else if (!autoSubject) {
    autoSubject = "General question";
  }

  const { data: thread, error: threadErr } = await admin
    .from("wfm_clarification_threads")
    .insert({
      tenant_id: tenantId,
      employee_id: targetEmployeeId,
      anchor_type,
      target_event_id: anchor_type === "punch" ? target_event_id : null,
      target_correction_id: anchor_type === "correction" ? target_correction_id : null,
      target_ot_session_id: anchor_type === "ot_session" ? target_ot_session_id : null,
      subject: autoSubject,
      opened_by_role: isSupervisor ? "supervisor" : "employee",
    })
    .select("*")
    .single();
  if (threadErr) return NextResponse.json({ error: threadErr.message }, { status: 500 });

  const { data: message, error: msgErr } = await admin
    .from("wfm_clarification_messages")
    .insert({
      tenant_id: tenantId,
      thread_id: thread.id,
      employee_id: targetEmployeeId,
      sender_role: isSupervisor ? "supervisor" : "employee",
      sender_user_id: userId,
      body: messageBody.trim(),
    })
    .select("*")
    .single();
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  const config = await getWfmConfig(admin, tenantId);
  if (config.notifications.clarification_message) {
    const { data: emp } = await admin
      .from("employees").select("first_name, last_name").eq("id", targetEmployeeId).eq("tenant_id", tenantId).maybeSingle();
    const empName = [emp?.first_name, emp?.last_name].filter(Boolean).join(" ") || "an employee";
    // Notify the OTHER side: a supervisor opening it tells the employee, an
    // employee opening it tells their supervisor.
    const toEmails = isSupervisor
      ? [await getEmployeeLoginEmail(admin, tenantId, targetEmployeeId)].filter((e): e is string => !!e)
      : await getSupervisorEmails(admin, tenantId, targetEmployeeId);
    sendWfmNotification({
      sessionSupabase: supabase,
      tenantId,
      toEmails,
      subject: `New question — ${autoSubject}`,
      text: `${isSupervisor ? "Your supervisor" : empName} started a conversation: "${autoSubject}"\n\n${messageBody.trim()}`,
      link: { path: ROUTES.wfmMe, label: "Reply here" },
      relatedObjectType: "wfm_clarification_threads",
      relatedObjectId: thread.id,
      relatedObjectLabel: autoSubject,
    }).catch(() => {});
  }

  return NextResponse.json({ ...thread, messages: [message] });
}
