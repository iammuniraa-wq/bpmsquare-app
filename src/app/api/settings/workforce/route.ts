import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { DEFAULT_WFM_CONFIG, type TenantConfig, type WfmConfig } from "@/lib/constants";

// GET /api/settings/workforce — tenant WFM config with defaults filled in.
export async function GET() {
  let supabase, tenantId;
  try {
    ({ supabase, tenantId } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (!(await tenantHasFeature(supabase, tenantId, "wfm"))) {
    return NextResponse.json({ error: "Workforce isn't enabled for your workspace" }, { status: 403 });
  }

  const { data, error } = await supabase.from("tenants").select("config").eq("id", tenantId).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stored = ((data?.config as TenantConfig | null)?.wfm ?? {}) as Partial<WfmConfig>;
  return NextResponse.json({ ...DEFAULT_WFM_CONFIG, ...stored });
}

const FACE_MODES = ["off", "flag_only"];
const GEOFENCE_MODES = ["block", "flag", "off"];
const SELFIE_MODES = ["off", "shift", "all"];
const FACE_PUNCH_MODES = ["off", "kiosk"];
const NOTIFICATION_KEYS = ["late_arrival", "correction_pending", "leave_pending", "recheck_flagged"] as const;
const PUNCH_TYPE_KEYS = ["ot", "mobile_work", "business_trip"] as const;
// Codes are what employees.employment_type stores -- keep them machine-safe
// and stable; only the label is meant to be edited freely afterwards.
const CODE_RE = /^[a-z0-9_]{1,40}$/;

// PUT /api/settings/workforce — update tenant WFM config (admin only).
export async function PUT(request: NextRequest) {
  let tenantId, role;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminSupabase();
  if (!(await tenantHasFeature(admin, tenantId, "wfm"))) {
    return NextResponse.json({ error: "Workforce isn't enabled for your workspace" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Partial<WfmConfig> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const next: Partial<WfmConfig> = {};
  if (typeof body.timezone === "string" && body.timezone.trim()) next.timezone = body.timezone.trim();
  if (typeof body.deduct_breaks === "boolean") next.deduct_breaks = body.deduct_breaks;
  if (typeof body.leave_carry_forward === "boolean") next.leave_carry_forward = body.leave_carry_forward;
  if (typeof body.late_marks_per_half_day === "number" && body.late_marks_per_half_day > 0) {
    next.late_marks_per_half_day = Math.round(body.late_marks_per_half_day);
  }
  if (typeof body.selfie_retention_days === "number" && body.selfie_retention_days > 0) {
    next.selfie_retention_days = Math.round(body.selfie_retention_days);
  }
  if (typeof body.face_verification_mode === "string" && FACE_MODES.includes(body.face_verification_mode)) {
    next.face_verification_mode = body.face_verification_mode as WfmConfig["face_verification_mode"];
  }
  if (typeof body.face_punch === "string" && FACE_PUNCH_MODES.includes(body.face_punch)) {
    next.face_punch = body.face_punch as WfmConfig["face_punch"];
  }
  if (
    Array.isArray(body.week_off_days) &&
    body.week_off_days.every((d) => typeof d === "number" && d >= 0 && d <= 6)
  ) {
    next.week_off_days = [...new Set(body.week_off_days)].sort();
  }
  if (typeof body.geofence_mode === "string" && GEOFENCE_MODES.includes(body.geofence_mode)) {
    next.geofence_mode = body.geofence_mode as WfmConfig["geofence_mode"];
  }
  if (typeof body.require_location === "boolean") {
    next.require_location = body.require_location;
  }
  if (typeof body.employee_self_service === "boolean") {
    next.employee_self_service = body.employee_self_service;
  }
  if (body.login_mode === "email" || body.login_mode === "code") {
    next.login_mode = body.login_mode;
  }
  if (typeof body.face_login === "boolean") {
    next.face_login = body.face_login;
  }
  if (typeof body.passkey_login === "boolean") {
    next.passkey_login = body.passkey_login;
  }
  if (typeof body.selfie_mode === "string" && SELFIE_MODES.includes(body.selfie_mode)) {
    next.selfie_mode = body.selfie_mode as WfmConfig["selfie_mode"];
  }
  if (typeof body.ot_rate_per_hour === "number" && isFinite(body.ot_rate_per_hour) && body.ot_rate_per_hour >= 0) {
    next.ot_rate_per_hour = body.ot_rate_per_hour;
  }
  if (body.punch_types && typeof body.punch_types === "object") {
    const incoming = body.punch_types as Partial<WfmConfig["punch_types"]>;
    const punchTypes: Partial<WfmConfig["punch_types"]> = {};
    for (const key of PUNCH_TYPE_KEYS) {
      if (typeof incoming[key] === "boolean") punchTypes[key] = incoming[key];
    }
    if (Object.keys(punchTypes).length > 0) {
      next.punch_types = { ...DEFAULT_WFM_CONFIG.punch_types, ...punchTypes };
    }
  }
  if (Array.isArray(body.employment_types)) {
    const cleaned = body.employment_types
      .filter((t): t is { code: string; label: string } =>
        !!t && typeof t.code === "string" && typeof t.label === "string" &&
        CODE_RE.test(t.code.trim()) && t.label.trim().length > 0)
      .map((t) => ({ code: t.code.trim(), label: t.label.trim().slice(0, 60) }));
    // De-dupe on code, and never let a tenant save an EMPTY list -- employees
    // must always have at least one assignable type.
    const seen = new Set<string>();
    const unique = cleaned.filter((t) => (seen.has(t.code) ? false : (seen.add(t.code), true)));
    if (unique.length > 0) next.employment_types = unique;
  }
  if (body.notifications && typeof body.notifications === "object") {
    const incoming = body.notifications as Partial<WfmConfig["notifications"]>;
    const notifications: Partial<WfmConfig["notifications"]> = {};
    for (const key of NOTIFICATION_KEYS) {
      if (typeof incoming[key] === "boolean") notifications[key] = incoming[key];
    }
    if (Object.keys(notifications).length > 0) {
      next.notifications = { ...DEFAULT_WFM_CONFIG.notifications, ...notifications };
    }
  }

  // Long-day push alert. after_hours is clamped rather than rejected: a
  // typo'd 0 or 99 would otherwise either buzz everyone constantly or never
  // fire, both silently.
  if (body.long_day_alert && typeof body.long_day_alert === "object") {
    const incoming = body.long_day_alert as { enabled?: unknown; after_hours?: unknown };
    const current = DEFAULT_WFM_CONFIG.long_day_alert;
    next.long_day_alert = {
      enabled: typeof incoming.enabled === "boolean" ? incoming.enabled : current.enabled,
      after_hours:
        typeof incoming.after_hours === "number" && Number.isFinite(incoming.after_hours)
          ? Math.min(24, Math.max(1, Math.round(incoming.after_hours * 2) / 2))
          : current.after_hours,
    };
  }

  const { data: current, error: readErr } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const currentConfig = (current?.config ?? {}) as TenantConfig;
  const merged: TenantConfig = { ...currentConfig, wfm: { ...currentConfig.wfm, ...next } };

  const { error } = await admin.from("tenants").update({ config: merged }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The login page's branding is cached (unstable_cache, 5 min) and carries
  // login_mode/face_login, so bust it now -- otherwise a just-toggled
  // "Face sign-in" or "Employee login" wouldn't reach the login screen until
  // the cache expired.
  revalidateTag("tenant-branding", { expire: 0 });

  return NextResponse.json({ ...DEFAULT_WFM_CONFIG, ...merged.wfm });
}
