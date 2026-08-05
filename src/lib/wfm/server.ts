import "server-only";

import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import { DEFAULT_WFM_CONFIG, type TenantConfig, type WfmConfig } from "@/lib/constants";
import type { WfmEmployee, WfmSite } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WfmContext = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  role: "admin" | "member";
  /** This login's employee record (via tenant_users.employee_id), if linked. */
  employee: WfmEmployee | null;
  /** Tenant admins and wfm_role=supervisor employees. */
  isSupervisor: boolean;
};

const EMPLOYEE_COLS =
  "id, employee_code, first_name, last_name, phone, status, employment_type, shift_id, site_id, wfm_role, technician_id, enrolled_photo_path, consent_recorded_at";

/**
 * Auth + feature gate for every /api/wfm/** route. Throws the same
 * { status, message } shape as requireTenantUser() so routes handle both
 * with one catch. WFM tables are read-only under RLS by design — all
 * writes in wfm routes use createAdminSupabase() with explicit tenant
 * filters (see 0062_wfm_module.sql header).
 */
export async function requireWfm(): Promise<WfmContext> {
  const { supabase, tenantId, userId, role } = await requireTenantUser();

  if (!(await tenantHasFeature(supabase, tenantId, "wfm"))) {
    throw { status: 404, message: "Not found" };
  }

  const { data: membership } = await supabase
    .from("tenant_users")
    .select("employee_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  let employee: WfmEmployee | null = null;
  if (membership?.employee_id) {
    const { data } = await supabase
      .from("employees")
      .select(EMPLOYEE_COLS)
      .eq("tenant_id", tenantId)
      .eq("id", membership.employee_id)
      .maybeSingle();
    employee = (data as WfmEmployee | null) ?? null;
  }

  return {
    supabase,
    tenantId,
    userId,
    role,
    employee,
    isSupervisor: role === "admin" || employee?.wfm_role === "supervisor",
  };
}

/** requireWfm + must be an active employee (punch/timesheet/corrections). */
export async function requireWfmEmployee(): Promise<WfmContext & { employee: WfmEmployee }> {
  const ctx = await requireWfm();
  if (!ctx.employee || ctx.employee.status !== "active") {
    throw { status: 403, message: "No active employee profile" };
  }
  return ctx as WfmContext & { employee: WfmEmployee };
}

/** requireWfm + supervisor or admin (live board, corrections queue, management). */
export async function requireWfmSupervisor(): Promise<WfmContext> {
  const ctx = await requireWfm();
  if (!ctx.isSupervisor) throw { status: 403, message: "Forbidden" };
  return ctx;
}

/** Tenant WFM config with defaults filled in. */
export async function getWfmConfig(supabase: SupabaseClient, tenantId: string): Promise<WfmConfig> {
  const { data } = await supabase.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const stored = ((data?.config as TenantConfig | null)?.wfm ?? {}) as Partial<WfmConfig>;
  return { ...DEFAULT_WFM_CONFIG, ...stored };
}

// ── Geofence ─────────────────────────────────────────────────────────────

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Match a punch location against the tenant's active sites. Policy: outside
 * every geofence is flagged, never rejected.
 */
export function matchSite(
  sites: WfmSite[],
  lat: number | null,
  lng: number | null
): { site: WfmSite | null; within: boolean | null } {
  if (lat == null || lng == null) return { site: null, within: null };
  let nearest: WfmSite | null = null;
  let nearestDist = Infinity;
  for (const s of sites) {
    if (!s.active) continue;
    const d = haversineMeters(lat, lng, s.lat, s.lng);
    if (d < nearestDist) {
      nearest = s;
      nearestDist = d;
    }
  }
  if (nearest && nearestDist <= nearest.radius_m) return { site: nearest, within: true };
  // outside all radii: still report the nearest site for supervisor context
  return { site: nearest, within: false };
}

function tzOffsetMs(timezone: string, utcDate: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(dtf.formatToParts(utcDate).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour % 24, +parts.minute, +parts.second
  );
  return asUtc - utcDate.getTime();
}

/** The UTC instant of `time` (HH:MM[:SS]) on `dateKey` (YYYY-MM-DD) in `timezone`. */
export function zonedTimestamp(dateKey: string, time: string, timezone: string): Date {
  const hms = time.length === 5 ? `${time}:00` : time;
  const naive = new Date(`${dateKey}T${hms}Z`);
  return new Date(naive.getTime() - tzOffsetMs(timezone, naive));
}

/** Today's date key (YYYY-MM-DD) in the tenant's timezone. */
export function dateKeyInTz(ts: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ts);
}
