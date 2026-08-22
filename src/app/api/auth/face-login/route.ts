import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { faceConfigured, searchFace } from "@/lib/wfm/face";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";

// POST /api/auth/face-login — sign in to the portal by face (opt-in per
// tenant, client decision 2026-08-21). Unauthenticated by nature: the caller
// has no session yet, so the tenant is resolved from the HOST (its own
// domain), exactly like the login page's branding. One camera frame is
// matched against the tenant's enrolled faces; on a confident match we mint a
// one-time magic-link token for that employee's login and hand it back, and
// the client finishes sign-in through the existing /auth/callback (which sets
// the session cookies server-side). Nothing here reveals WHO matched — a
// failure is always the same generic message, so it can't be used to probe
// which employees exist or are enrolled.
//
// Security posture:
// - Stricter similarity bar than punching (FACE_LOGIN_MIN_CONFIDENCE): a wrong
//   match grants account access, not just a bad attendance row.
// - No liveness detection yet, so a photo of the employee could sign in. This
//   is why face_login is opt-in and off by default; add liveness before wide
//   rollout.

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
// Rekognition similarity (0-100). searchFace already floors at 95 for the
// kiosk; login demands more because it opens a session, not a punch.
const FACE_LOGIN_MIN_CONFIDENCE = 98;
const GENERIC = "Face not recognised. Try again, or sign in with your ID and password.";

function hostOf(request: NextRequest): string {
  return (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
}

export async function POST(request: NextRequest) {
  const host = hostOf(request);
  if (!host) return NextResponse.json({ error: GENERIC }, { status: 400 });

  const admin = createAdminSupabase();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, features, config")
    .eq("custom_domain", host)
    .maybeSingle();
  if (!tenant) return NextResponse.json({ error: GENERIC }, { status: 400 });

  const tenantId = tenant.id as string;
  const features = (tenant.features ?? {}) as TenantFeatures;
  const config = ((tenant.config as TenantConfig | null)?.wfm ?? {}) as { face_login?: boolean };
  if (features.wfm !== true || config.face_login !== true) {
    return NextResponse.json({ error: "Face sign-in isn't enabled for this workspace." }, { status: 403 });
  }
  if (!faceConfigured()) {
    return NextResponse.json({ error: "Face sign-in isn't available right now." }, { status: 503 });
  }

  const form = await request.formData().catch(() => null);
  const frame = form?.get("frame");
  if (!(frame instanceof File)) {
    return NextResponse.json({ error: "A camera frame is required" }, { status: 400 });
  }
  if (!ALLOWED.has(frame.type)) return NextResponse.json({ error: "Unsupported image" }, { status: 400 });
  if (frame.size > MAX_BYTES) return NextResponse.json({ error: "Image too large" }, { status: 400 });

  const buf = Buffer.from(await frame.arrayBuffer());

  let match;
  try {
    match = await searchFace(tenantId, buf);
  } catch (e) {
    console.error("face-login: search failed:", (e as Error).message);
    return NextResponse.json({ error: "Face sign-in isn't available right now." }, { status: 502 });
  }
  // Every refusal below shows the client one GENERIC message (deliberate --
  // no oracle), so the true reason is logged server-side for operators. Ids
  // only, no personal data.
  const refuse = (reason: string) => {
    console.error(`face-login refused [tenant ${tenantId}]: ${reason}`);
    return NextResponse.json({ error: GENERIC }, { status: 401 });
  };

  if (!match) {
    return refuse("no match in collection (not enrolled on this tenant, or frame unusable)");
  }
  if (match.confidence < FACE_LOGIN_MIN_CONFIDENCE) {
    return refuse(`match ${match.employeeId} at ${match.confidence.toFixed(2)}% — below login bar ${FACE_LOGIN_MIN_CONFIDENCE}`);
  }

  // The matched employee must be active AND have a usable login for THIS
  // tenant that isn't locked or outside its validity window. Any miss returns
  // the same generic message — no signal about which condition failed.
  const { data: employee } = await admin
    .from("employees")
    .select("id, status")
    .eq("id", match.employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!employee || employee.status !== "active") {
    return refuse(`matched ${match.employeeId} but employee is ${employee ? employee.status : "not found in tenant"}`);
  }

  const { data: membership } = await admin
    .from("tenant_users")
    .select("user_id, is_locked, valid_from, valid_to")
    .eq("tenant_id", tenantId)
    .eq("employee_id", match.employeeId)
    .maybeSingle();
  if (!membership || membership.is_locked) {
    return refuse(`matched ${match.employeeId} but ${membership ? "login is locked" : "no login is linked to this employee"}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  if ((membership.valid_from && today < membership.valid_from) || (membership.valid_to && today > membership.valid_to)) {
    return refuse(`matched ${match.employeeId} but membership outside validity window`);
  }

  const { data: userRes } = await admin.auth.admin.getUserById(membership.user_id);
  const email = userRes?.user?.email;
  if (!email) return refuse(`matched ${match.employeeId} but auth user has no email`);

  // Mint a single-use magic-link token for this login. Same mechanism as the
  // password-reset email (api/auth/request-reset) — generateLink returns the
  // hashed_token that verifyOtp accepts from any browser, and /auth/callback
  // exchanges it for a session and sets the cookies. We never send an email;
  // the token is returned only in this direct HTTPS response to the person who
  // just passed the face match.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error("face-login: generateLink failed:", linkErr?.message);
    return NextResponse.json({ error: "Face sign-in isn't available right now." }, { status: 500 });
  }

  return NextResponse.json({ token_hash: link.properties.hashed_token });
}
