import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { getSupervisorEmails, getEmployeeLoginEmail, sendWfmNotification } from "@/lib/wfm/notify";
import { ROUTES } from "@/lib/constants";

/** May this caller see/act on a thread about `employeeId`? Same "own rows or
 *  my subtree" rule the RLS policy encodes, re-checked here because every
 *  write goes through the admin client (RLS doesn't apply to it). */
async function canAccessThread(
  ctx: Awaited<ReturnType<typeof requireWfm>>,
  employeeId: string
): Promise<boolean> {
  if (!ctx.isSupervisor) return ctx.employee?.id === employeeId;
  const scope = await resolveWfmScope(ctx);
  return scope.unrestricted || (scope.employeeIds ?? []).includes(employeeId);
}

// GET /api/wfm/clarifications/[id] — one thread with its full message list.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId } = ctx;
  const { id } = await params;

  const admin = createAdminSupabase();
  const { data: thread } = await admin
    .from("wfm_clarification_threads")
    .select("*, employees(first_name, last_name, employee_code)")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canAccessThread(ctx, thread.employee_id as string))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: messages, error } = await admin
    .from("wfm_clarification_messages")
    .select("*")
    .eq("thread_id", id).eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ...thread, messages: messages ?? [] });
}

// PATCH /api/wfm/clarifications/[id] — post a reply and/or resolve/reopen.
// At least one of `message` / `resolve` is required; both may be sent
// together ("here's the answer, and that closes it out").
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, userId, isSupervisor } = ctx;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const { message, resolve } = (body ?? {}) as { message?: string; resolve?: boolean };
  if (message === undefined && resolve === undefined) {
    return NextResponse.json({ error: "Provide a message, resolve, or both" }, { status: 400 });
  }
  if (message !== undefined && !message.trim()) {
    return NextResponse.json({ error: "message cannot be empty" }, { status: 400 });
  }

  const admin = createAdminSupabase();
  const { data: thread } = await admin
    .from("wfm_clarification_threads")
    .select("*")
    .eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canAccessThread(ctx, thread.employee_id as string))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (message !== undefined) {
    const { error: msgErr } = await admin.from("wfm_clarification_messages").insert({
      tenant_id: tenantId,
      thread_id: id,
      employee_id: thread.employee_id,
      sender_role: isSupervisor ? "supervisor" : "employee",
      sender_user_id: userId,
      body: message.trim(),
    });
    if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (resolve === true) {
    update.status = "resolved";
    update.resolved_by = userId;
    update.resolved_at = new Date().toISOString();
  } else if (resolve === false) {
    update.status = "open";
    update.resolved_by = null;
    update.resolved_at = null;
  }
  // A reply alone reopens a thread someone had marked resolved -- getting a
  // new question after "resolved" shouldn't require a separate un-resolve.
  if (message !== undefined && resolve === undefined && thread.status === "resolved") {
    update.status = "open";
    update.resolved_by = null;
    update.resolved_at = null;
  }

  const { data: updated, error } = await admin
    .from("wfm_clarification_threads")
    .update(update)
    .eq("id", id).eq("tenant_id", tenantId)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (message !== undefined) {
    const config = await getWfmConfig(admin, tenantId);
    if (config.notifications.clarification_message) {
      const { data: emp } = await admin
        .from("employees").select("first_name, last_name").eq("id", thread.employee_id).eq("tenant_id", tenantId).maybeSingle();
      const empName = [emp?.first_name, emp?.last_name].filter(Boolean).join(" ") || "an employee";
      const toEmails = isSupervisor
        ? [await getEmployeeLoginEmail(admin, tenantId, thread.employee_id as string)].filter((e): e is string => !!e)
        : await getSupervisorEmails(admin, tenantId, thread.employee_id as string);
      sendWfmNotification({
        sessionSupabase: ctx.supabase,
        tenantId,
        toEmails,
        subject: `New reply — ${thread.subject}`,
        text: `${isSupervisor ? "Your supervisor" : empName} replied on "${thread.subject}":\n\n${message.trim()}`,
        link: { path: ROUTES.wfmMe, label: "Reply here" },
        relatedObjectType: "wfm_clarification_threads",
        relatedObjectId: id,
        relatedObjectLabel: thread.subject as string,
      }).catch(() => {});
    }
  }

  return NextResponse.json(updated);
}
