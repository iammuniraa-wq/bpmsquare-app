import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "crypto";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, getWfmConfig } from "@/lib/wfm/server";
import { faceConfigured, indexFace, deleteFaces } from "@/lib/wfm/face";
import { revokeFaceEnrollment } from "@/lib/wfm/faceEnrollment";

const MAX_FRAMES = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

// Enrollment is SELF-SERVICE first (client decision 2026-08-20: employees
// with logins set up their own face from their own account; the kiosk —
// the "general login" on the door — then matches against that same data),
// with supervisors able to enroll/revoke anyone as the fallback for
// employees without logins. Consent on a self-enrollment therefore happens
// on the employee's own authenticated session. Every path checks
// face_punch is enabled — a tenant that never bought this 404s away.

async function guard() {
  const ctx = await requireWfm();
  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, ctx.tenantId);
  if (config.face_punch === "off") {
    const err = new Error("Face punch is not enabled for this workspace") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  return { ...ctx, admin };
}

/** Self on their own record, or any supervisor. */
function mayManage(ctx: Awaited<ReturnType<typeof guard>>, employeeId: string): boolean {
  return ctx.isSupervisor || ctx.employee?.id === employeeId;
}

// GET — enrollment status per employee, for the Employees screen. The
// client uses `enabled`/`configured` to self-gate its UI, so the screen
// needs no config plumbing of its own.
export async function GET() {
  try {
    const ctx = await requireWfm();
    const admin = createAdminSupabase();
    const config = await getWfmConfig(admin, ctx.tenantId);
    if (config.face_punch === "off") {
      return NextResponse.json({ enabled: false, configured: false, enrollments: [] });
    }
    let q = admin
      .from("wfm_face_enrollments")
      .select("employee_id, status, created_at, photo_paths")
      .eq("tenant_id", ctx.tenantId);
    if (!ctx.isSupervisor) q = q.eq("employee_id", ctx.employee?.id ?? "00000000-0000-0000-0000-000000000000");
    const { data } = await q;
    return NextResponse.json({
      enabled: true,
      configured: faceConfigured(),
      enrollments: (data ?? []).map((r) => ({
        employee_id: r.employee_id,
        status: r.status,
        created_at: r.created_at,
        frames: ((r.photo_paths as string[]) ?? []).length,
      })),
    });
  } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

// POST — enroll (or re-enroll) one employee. Multipart: employee_id,
// consent ("true" — the employee tapped agree on the consent screen),
// 1–3 camera frames.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await guard();
  } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
  const { tenantId, userId, admin } = ctx;

  if (!faceConfigured()) {
    return NextResponse.json(
      { error: "Face service is not configured yet — the FACE_AWS_* keys are missing on the server." },
      { status: 503 }
    );
  }

  const form = await request.formData().catch(() => null);
  const employeeId = form?.get("employee_id");
  const consent = form?.get("consent");
  const frames = (form?.getAll("frames") ?? []).filter((f): f is File => f instanceof File);

  if (typeof employeeId !== "string" || !employeeId) {
    return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  }
  if (consent !== "true") {
    return NextResponse.json({ error: "Biometric consent must be recorded before enrollment" }, { status: 400 });
  }
  if (frames.length === 0 || frames.length > MAX_FRAMES) {
    return NextResponse.json({ error: `1–${MAX_FRAMES} camera frames required` }, { status: 400 });
  }
  for (const f of frames) {
    if (!ALLOWED.has(f.type)) return NextResponse.json({ error: "Only JPEG/PNG/WebP allowed" }, { status: 400 });
    if (f.size > MAX_BYTES) return NextResponse.json({ error: "Frame too large (max 2 MB)" }, { status: 400 });
  }

  if (!mayManage(ctx, employeeId)) {
    return NextResponse.json({ error: "You can only enroll your own face" }, { status: 403 });
  }

  const { data: employee } = await admin
    .from("employees")
    .select("id, status")
    .eq("id", employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  if (employee.status !== "active") {
    return NextResponse.json({ error: "Only active employees can be enrolled" }, { status: 409 });
  }

  // Re-enrollment replaces, never accumulates: old templates and photos go
  // first, so a face change (glasses, beard, better lighting) starts clean.
  await revokeFaceEnrollment(admin, tenantId, employeeId);

  const faceIds: string[] = [];
  const photoPaths: string[] = [];
  const ext: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

  for (const frame of frames) {
    const buf = Buffer.from(await frame.arrayBuffer());
    let faceId: string | null = null;
    try {
      faceId = await indexFace(tenantId, employeeId, buf);
    } catch (e) {
      console.error("face enroll: provider index failed:", (e as Error).message);
      return NextResponse.json({ error: "Face service error — try again in a moment" }, { status: 502 });
    }
    if (!faceId) continue; // unusable frame (blur, no face) — skip, don't fail the batch

    const path = `${tenantId}/face-enroll/${employeeId}/${randomUUID()}.${ext[frame.type]}`;
    const { error: upErr } = await admin.storage
      .from("wfm")
      .upload(path, frame, { contentType: frame.type, upsert: false });
    if (upErr) {
      console.error("face enroll: photo upload failed:", upErr.message);
    } else {
      photoPaths.push(path);
    }
    faceIds.push(faceId);
  }

  if (faceIds.length === 0) {
    return NextResponse.json(
      { error: "No usable face found in the photos — retake facing the camera in better light." },
      { status: 422 }
    );
  }

  const { error: upsertErr } = await admin.from("wfm_face_enrollments").upsert(
    {
      tenant_id: tenantId,
      employee_id: employeeId,
      provider: "aws_rekognition",
      provider_face_ids: faceIds,
      photo_paths: photoPaths,
      consent_recorded_at: new Date().toISOString(),
      enrolled_by: userId,
      status: "active",
    },
    { onConflict: "tenant_id,employee_id" }
  );
  if (upsertErr) {
    // The AWS templates and photos already exist at this point. If the row
    // that references them never lands, they are orphaned biometric data --
    // no revoke or retention path can ever reach them (both key off this
    // row), a DPDP erasure-right violation. Clean them up here. deleteFaces
    // is idempotent; the bucket paths we just wrote are removed directly
    // (revokeFaceEnrollment can't run -- there's no row to read them from).
    console.error("face enroll: row upsert failed, rolling back provider + photos:", upsertErr.message);
    await deleteFaces(tenantId, faceIds).catch((e) =>
      console.error("face enroll rollback: provider delete failed:", (e as Error).message)
    );
    if (photoPaths.length > 0) {
      await admin.storage.from("wfm").remove(photoPaths).catch(() => {});
    }
    return NextResponse.json({ error: "Could not save the enrollment" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, faces: faceIds.length });
}

// DELETE ?employee_id= — revoke: provider templates, our photos, row
// flipped to revoked. Consent withdrawn means everything goes.
export async function DELETE(request: NextRequest) {
  let ctx;
  try {
    ctx = await guard();
  } catch (e: unknown) {
    const err = e as { status?: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
  const employeeId = request.nextUrl.searchParams.get("employee_id");
  if (!employeeId) return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
  if (!mayManage(ctx, employeeId)) {
    return NextResponse.json({ error: "You can only revoke your own enrollment" }, { status: 403 });
  }

  await revokeFaceEnrollment(ctx.admin, ctx.tenantId, employeeId);
  return NextResponse.json({ ok: true });
}
