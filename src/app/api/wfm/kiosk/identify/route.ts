import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { authenticateKiosk, signMatchTicket } from "@/lib/wfm/kiosk";
import { getWfmConfig } from "@/lib/wfm/server";
import { faceConfigured, searchFace } from "@/lib/wfm/face";
import { punchStateAt } from "@/lib/wfm/hours";
import { allowedKinds, type PresenceKind } from "@/lib/wfm/types";

const MAX_BYTES = 2 * 1024 * 1024;
// The kiosk's four buttons — OT/mobile/trip punches stay on the phone,
// where the person is logged in as themselves.
const KIOSK_KINDS: PresenceKind[] = ["check_in", "check_out", "break_start", "break_end"];

// POST /api/wfm/kiosk/identify — one camera frame in, "who is this and
// what may they do" out. Returns a short-lived match ticket that the punch
// call must present, so holding the device token alone never lets anyone
// punch for an arbitrary employee (see lib/wfm/kiosk.ts).
export async function POST(request: NextRequest) {
  const admin = createAdminSupabase();
  const device = await authenticateKiosk(request, admin);
  if (!device) return NextResponse.json({ error: "Invalid kiosk code" }, { status: 401 });

  const config = await getWfmConfig(admin, device.tenant_id);
  if (config.face_punch === "off") {
    return NextResponse.json({ error: "Face punch is switched off" }, { status: 403 });
  }
  if (!faceConfigured()) {
    return NextResponse.json({ error: "Face service is not configured yet" }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const frame = form?.get("frame");
  if (!(frame instanceof File) || frame.size === 0) {
    return NextResponse.json({ error: "frame is required" }, { status: 400 });
  }
  if (frame.size > MAX_BYTES) {
    return NextResponse.json({ error: "Frame too large" }, { status: 400 });
  }

  let match;
  try {
    match = await searchFace(device.tenant_id, Buffer.from(await frame.arrayBuffer()));
  } catch (e) {
    console.error("kiosk identify: search failed:", (e as Error).message);
    return NextResponse.json({ error: "Face service error — try again" }, { status: 502 });
  }
  if (!match) return NextResponse.json({ match: false });

  // Defense in depth behind the provider: the enrollment row must still be
  // active (revoke deletes provider templates, so a match here should be
  // impossible for a revoked face — but a delete that failed half-way must
  // not reopen the door), and the employee must still be active.
  const [{ data: enrollment }, { data: employee }] = await Promise.all([
    admin
      .from("wfm_face_enrollments")
      .select("status")
      .eq("tenant_id", device.tenant_id)
      .eq("employee_id", match.employeeId)
      .maybeSingle(),
    admin
      .from("employees")
      .select("id, first_name, last_name, employee_code, status, shift_id")
      .eq("id", match.employeeId)
      .eq("tenant_id", device.tenant_id)
      .maybeSingle(),
  ]);
  if (enrollment?.status !== "active" || !employee || employee.status !== "active") {
    return NextResponse.json({ match: false });
  }

  // Same state machine as every other punch surface: only the transitions
  // that are actually legal right now become buttons.
  const [{ data: shift }, { data: last }] = await Promise.all([
    employee.shift_id
      ? admin
          .from("wfm_shifts")
          .select("start_time, crosses_midnight")
          .eq("id", employee.shift_id)
          .eq("tenant_id", device.tenant_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("wfm_presence_events")
      .select("kind, ts")
      .eq("tenant_id", device.tenant_id)
      .eq("employee_id", employee.id)
      .is("superseded_by", null)
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const state = punchStateAt(
    last ? { kind: last.kind as PresenceKind, ts: last.ts as string } : null,
    new Date(),
    config.timezone,
    shift
  );
  const kinds = allowedKinds(state).filter((k) => KIOSK_KINDS.includes(k));

  return NextResponse.json({
    match: true,
    name: [employee.first_name, employee.last_name].filter(Boolean).join(" "),
    employee_code: employee.employee_code,
    confidence: Math.round(match.confidence * 10) / 10,
    state,
    kinds,
    ticket: signMatchTicket(employee.id, device.id),
  });
}
