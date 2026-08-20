import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee, getWfmConfig } from "@/lib/wfm/server";
import { faceConfigured, verifyFace } from "@/lib/wfm/face";

const MAX_BYTES = 2 * 1024 * 1024; // client compresses to ~200–400 KB; hard cap 2 MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// POST /api/wfm/punch/selfie — attach the selfie to an already-recorded
// punch (multipart: event_id + file). Runs after punch confirmation so a
// slow upload never blocks the punch; the offline queue retries it.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, employee } = ctx;

  const form = await request.formData().catch(() => null);
  const eventId = form?.get("event_id");
  const file = form?.get("file");
  if (typeof eventId !== "string" || !(file instanceof File)) {
    return NextResponse.json({ error: "event_id and file are required" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Only JPEG/PNG/WebP allowed" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large (max 2 MB)" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Only the punching employee's own recent selfie-source event, set-once.
  const { data: event } = await admin
    .from("wfm_presence_events")
    .select("id, ts, selfie_path, source")
    .eq("id", eventId)
    .eq("tenant_id", tenantId)
    .eq("employee_id", employee.id)
    .maybeSingle();

  if (!event || event.source !== "web_selfie") {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  if (event.selfie_path) {
    return NextResponse.json({ ok: true, duplicate: true });
  }
  if (Date.now() - new Date(event.ts).getTime() > 48 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "Event too old to attach a selfie" }, { status: 409 });
  }

  const month = event.ts.slice(0, 7); // yyyy-mm
  const path = `${tenantId}/${employee.id}/${month}/${event.id}.${EXT[file.type]}`;

  const { error: uploadErr } = await admin.storage
    .from("wfm")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadErr && !uploadErr.message.includes("already exists")) {
    console.error("wfm selfie upload failed:", uploadErr.message);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { error: updateErr } = await admin
    .from("wfm_presence_events")
    .update({ selfie_path: path })
    .eq("id", event.id)
    .eq("tenant_id", tenantId)
    .is("selfie_path", null);
  if (updateErr) {
    console.error("wfm selfie path update failed:", updateErr.message);
    return NextResponse.json({ error: "Could not attach selfie" }, { status: 500 });
  }

  // face_verification_mode "flag_only": compare this selfie against the
  // employee's enrolled face and FLAG the event -- never block, never fail
  // the upload (the config key's documented contract). face_mismatch also
  // covers "matches a DIFFERENT enrolled employee": the buddy-punch case.
  // A frame with no usable face gets its own flag so a dark stairwell
  // photo isn't reported as an impostor.
  try {
    const config = await getWfmConfig(admin, tenantId);
    if (config.face_verification_mode === "flag_only" && faceConfigured()) {
      const { data: enrollment } = await admin
        .from("wfm_face_enrollments")
        .select("status")
        .eq("tenant_id", tenantId)
        .eq("employee_id", employee.id)
        .maybeSingle();
      if (enrollment?.status === "active") {
        const result = await verifyFace(tenantId, employee.id, Buffer.from(await file.arrayBuffer()));
        const flagPatch =
          result === null ? { face_unreadable: true }
          : result.verified ? { face_verified: true }
          : { face_mismatch: true };
        const { data: cur } = await admin
          .from("wfm_presence_events")
          .select("flags")
          .eq("id", event.id)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        await admin
          .from("wfm_presence_events")
          .update({ flags: { ...((cur?.flags as Record<string, unknown>) ?? {}), ...flagPatch } })
          .eq("id", event.id)
          .eq("tenant_id", tenantId);
      }
    }
  } catch (e) {
    console.error("selfie face verification failed:", (e as Error).message);
  }

  return NextResponse.json({ ok: true, path });
}
