import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, requireWfmSupervisor, getWfmConfig } from "@/lib/wfm/server";
import { getEmployeeLoginEmail, sendWfmNotification, wfmUrl } from "@/lib/wfm/notify";
import { ROUTES } from "@/lib/constants";

const TYPES = ["time", "selfie", "both"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/wfm/recheck-requests — supervisors see the tenant queue
// (optionally ?status=pending); everyone else sees only requests flagged
// against them. Mirrors GET /api/wfm/corrections.
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
    .from("wfm_recheck_requests")
    .select(isSupervisor ? "*, employees(first_name, last_name, employee_code)" : "*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (!isSupervisor) {
    if (!employee) return NextResponse.json({ error: "No employee profile" }, { status: 403 });
    query = query.eq("employee_id", employee.id);
  } else if (employeeIdParam) {
    query = query.eq("employee_id", employeeIdParam);
  }
  if (status === "pending" || status === "responded" || status === "resolved" || status === "dismissed") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST /api/wfm/recheck-requests — a supervisor flags a punch (or a whole
// day, if target_event_id is omitted) and asks the employee to recheck it.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmSupervisor();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, userId } = ctx;

  const body = await request.json().catch(() => null);
  const { employee_id, target_date, target_event_id, recheck_type, message } = (body ?? {}) as {
    employee_id?: string; target_date?: string; target_event_id?: string;
    recheck_type?: string; message?: string;
  };

  if (!employee_id) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  if (!target_date || !DATE_RE.test(target_date)) {
    return NextResponse.json({ error: "target_date (YYYY-MM-DD) is required" }, { status: 400 });
  }
  if (!message?.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });
  const type = TYPES.includes(recheck_type as (typeof TYPES)[number]) ? recheck_type! : "both";

  const admin = createAdminSupabase();

  const { data: employee } = await admin
    .from("employees").select("id, first_name, last_name").eq("id", employee_id).eq("tenant_id", tenantId).maybeSingle();
  if (!employee) return NextResponse.json({ error: "Unknown employee" }, { status: 400 });

  let verifiedEventId: string | null = null;
  if (target_event_id) {
    const { data: event } = await admin
      .from("wfm_presence_events")
      .select("id")
      .eq("id", target_event_id)
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee_id)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: "Unknown event" }, { status: 400 });
    verifiedEventId = event.id;
  }

  const { data, error } = await admin
    .from("wfm_recheck_requests")
    .insert({
      tenant_id: tenantId,
      employee_id,
      target_date,
      target_event_id: verifiedEventId,
      recheck_type: type,
      supervisor_id: userId,
      message: message.trim(),
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const config = await getWfmConfig(admin, tenantId);
  if (config.notifications.recheck_flagged) {
    const empName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");
    const email = await getEmployeeLoginEmail(admin, tenantId, employee_id);
    if (email) {
      sendWfmNotification({
        sessionSupabase: ctx.supabase,
        tenantId,
        toEmails: [email],
        subject: `Please recheck your attendance — ${target_date}`,
        text: `Your supervisor has asked you to recheck your ${type === "both" ? "time and selfie" : type} for ${target_date}.\n\n"${message.trim()}"\n\nRespond here: ${wfmUrl(ROUTES.wfmMe)}`,
        relatedObjectType: "wfm_recheck_requests",
        relatedObjectId: data.id,
        relatedObjectLabel: `${empName} — ${target_date}`,
      }).catch(() => {});
    }
  }

  return NextResponse.json(data);
}
