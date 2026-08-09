import { NextResponse, type NextRequest } from "next/server";
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
  if (
    Array.isArray(body.week_off_days) &&
    body.week_off_days.every((d) => typeof d === "number" && d >= 0 && d <= 6)
  ) {
    next.week_off_days = [...new Set(body.week_off_days)].sort();
  }

  const { data: current, error: readErr } = await admin.from("tenants").select("config").eq("id", tenantId).single();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const currentConfig = (current?.config ?? {}) as TenantConfig;
  const merged: TenantConfig = { ...currentConfig, wfm: { ...currentConfig.wfm, ...next } };

  const { error } = await admin.from("tenants").update({ config: merged }).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...DEFAULT_WFM_CONFIG, ...merged.wfm });
}
