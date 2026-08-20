import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createAdminSupabase } from "@/lib/supabase-server";
import { authenticateKiosk, verifyMatchTicket } from "@/lib/wfm/kiosk";
import { getWfmConfig } from "@/lib/wfm/server";
import { punchStateAt } from "@/lib/wfm/hours";
import { applyPunch, PUNCH_KIND_LABEL, type PresenceKind } from "@/lib/wfm/types";

const KIOSK_KINDS: PresenceKind[] = ["check_in", "check_out", "break_start", "break_end"];
const MAX_BYTES = 2 * 1024 * 1024;
const KIOSK_SELFIE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// POST /api/wfm/kiosk/punch — record the punch the matched person chose.
// Multipart: kind, ticket (from identify, ≤60s old), frame (the matched
// camera frame, stored as the punch selfie so the audit trail carries the
// face that was actually at the door).
//
// The transition is re-validated HERE, not trusted from identify — the
// state can change between the two calls (their own phone punch, a
// correction), and the ticket only proves identity, never permission.
//
// Deliberately absent in v1, both noted rather than silent: the
// late-arrival email (its sender needs a user session the kiosk doesn't
// have — the live board and summary still mark Late, computed at read
// time) and OT kinds (phone-only, where the person is logged in).
export async function POST(request: NextRequest) {
  const admin = createAdminSupabase();
  const device = await authenticateKiosk(request, admin);
  if (!device) return NextResponse.json({ error: "Invalid kiosk code" }, { status: 401 });

  const config = await getWfmConfig(admin, device.tenant_id);
  if (config.face_punch === "off") {
    return NextResponse.json({ error: "Face punch is switched off" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const kind = form?.get("kind");
  const ticket = form?.get("ticket");
  const frame = form?.get("frame");

  if (typeof kind !== "string" || !KIOSK_KINDS.includes(kind as PresenceKind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  if (typeof ticket !== "string") {
    return NextResponse.json({ error: "ticket is required" }, { status: 400 });
  }
  const employeeId = verifyMatchTicket(ticket, device.id);
  if (!employeeId) {
    return NextResponse.json({ error: "Face match expired — scan again" }, { status: 401 });
  }

  const { data: employee } = await admin
    .from("employees")
    .select("id, first_name, last_name, status, shift_id")
    .eq("id", employeeId)
    .eq("tenant_id", device.tenant_id)
    .maybeSingle();
  if (!employee || employee.status !== "active") {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const now = new Date();
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
    now,
    config.timezone,
    shift
  );
  const next = applyPunch(state, kind as PresenceKind);
  if (!next) {
    return NextResponse.json(
      { error: `Cannot ${PUNCH_KIND_LABEL[kind as PresenceKind].toLowerCase()} while ${state}` },
      { status: 409 }
    );
  }

  // Selfie first, so the event row can carry its path from birth — no
  // second request, no punch-without-its-photo window.
  //
  // MIME is validated and the stored content-type + extension are derived
  // from the VALIDATED type, never from the attacker-controlled frame.type
  // (this route takes a device bearer token, not a user session). Without
  // this, a device-token holder could store image/svg+xml or text/html
  // under a .jpg name; Supabase serves it with the stored content-type, and
  // the punch-audit view opens the selfie as a top-level document -> stored
  // active content. The two sibling upload routes (punch/selfie,
  // face/enrollments) already do exactly this; this one had drifted.
  const eventId = randomUUID();
  let selfiePath: string | null = null;
  if (frame instanceof File && frame.size > 0) {
    if (frame.size > MAX_BYTES) {
      return NextResponse.json({ error: "Selfie too large" }, { status: 400 });
    }
    const ext = KIOSK_SELFIE_EXT[frame.type];
    if (!ext) {
      return NextResponse.json({ error: "Selfie must be JPEG, PNG or WebP" }, { status: 400 });
    }
    const path = `${device.tenant_id}/${employee.id}/${now.toISOString().slice(0, 7)}/${eventId}.${ext}`;
    const { error: upErr } = await admin.storage
      .from("wfm")
      .upload(path, frame, { contentType: frame.type, upsert: false });
    if (upErr) console.error("kiosk punch: selfie upload failed:", upErr.message);
    else selfiePath = path;
  }

  const { error } = await admin.from("wfm_presence_events").insert({
    id: eventId,
    tenant_id: device.tenant_id,
    employee_id: employee.id,
    ts: now.toISOString(),
    kind,
    source: "kiosk_face",
    site_id: device.site_id,
    within_geofence: true,
    selfie_path: selfiePath,
    flags: { kiosk_device_id: device.id },
    created_by: null,
  });
  if (error) {
    console.error("kiosk punch insert failed:", error.message);
    return NextResponse.json({ error: "Could not record punch" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    kind,
    ts: now.toISOString(),
    name: [employee.first_name, employee.last_name].filter(Boolean).join(" "),
    state: next,
  });
}
