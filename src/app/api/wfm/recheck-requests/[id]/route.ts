import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm } from "@/lib/wfm/server";

// PATCH /api/wfm/recheck-requests/[id] — two distinct actors, one endpoint:
//  - the flagged employee: action "respond" (their own explanation text)
//  - a supervisor/admin: action "resolve" or "dismiss" (closes it out)
// Never edits attendance data itself — an employee who wants an actual fix
// still files a real correction request (POST /api/wfm/corrections),
// optionally referencing this recheck via recheck_request_id so a
// supervisor reviewing the recheck can jump straight to it.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, userId, employee, isSupervisor } = ctx;
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const { action, employee_response_text } = (body ?? {}) as { action?: string; employee_response_text?: string };

  const admin = createAdminSupabase();
  const { data: req } = await admin
    .from("wfm_recheck_requests")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!req) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (action === "respond") {
    if (!employee || req.employee_id !== employee.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (req.status !== "pending") {
      return NextResponse.json({ error: "This request has already been responded to" }, { status: 409 });
    }
    if (!employee_response_text?.trim()) {
      return NextResponse.json({ error: "employee_response_text is required" }, { status: 400 });
    }
    const { data, error } = await admin
      .from("wfm_recheck_requests")
      .update({
        status: "responded",
        employee_response_text: employee_response_text.trim(),
        employee_responded_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  if (action === "resolve" || action === "dismiss") {
    if (!isSupervisor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (req.status === "resolved" || req.status === "dismissed") {
      return NextResponse.json({ error: "This request is already closed" }, { status: 409 });
    }
    const { data, error } = await admin
      .from("wfm_recheck_requests")
      .update({
        status: action === "resolve" ? "resolved" : "dismissed",
        resolved_by: userId,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .select("*")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  return NextResponse.json({ error: "action must be 'respond', 'resolve' or 'dismiss'" }, { status: 400 });
}
