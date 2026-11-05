import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllPages } from "@/lib/pagedRead";
import type { AttendanceConfigLike, AttendanceReads, PunchFlagRow, SiteInfoLike, SummaryRowLike } from "@/lib/crew/attendance/facts";
import { flagRowsFromEvents, type EventLike } from "./punchFlags";
import { getSummaryForRange } from "./monthlySummary";
import { getWfmConfig } from "./server";

// What the Attendance Anomalies agent reads from WFM (docs/design/nova-crew-agents.md section 3.4). Every function here takes (admin, tenantId): the admin client
// bypasses RLS, so EVERY query carries .eq("tenant_id", tenantId). Nothing returned carries a name, a code, a coordinate or a selfie path: people are ids
// (the engine turns them into aliases), a flagged punch is a shift-day, the kinds of flag and a distance bucket.

/** Events are read a day either side of the range so a night shift's tail belongs to the right shift-day. */
const PAD_DAYS = 1;
const addDay = (key: string, d: number): string => new Date(Date.parse(`${key}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

type EmployeeRow = { id: string; site_id: string | null; shift_id: string | null };

async function employeeRows(admin: SupabaseClient, tenantId: string, ids: string[]): Promise<EmployeeRow[]> {
  const rows: EmployeeRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from("employees").select("id, site_id, shift_id").eq("tenant_id", tenantId).in("id", ids.slice(i, i + 200));
    rows.push(...((data ?? []) as EmployeeRow[]));
  }
  return rows;
}

/** Flagged punches of these employees over the shift-days from..to. Tenant-scoped; no coordinates in the result. */
export async function getPunchFlagsForRange(admin: SupabaseClient, tenantId: string, from: string, to: string, employeeIds: string[]): Promise<PunchFlagRow[]> {
  if (employeeIds.length === 0) return [];
  const config = await getWfmConfig(admin, tenantId);
  const [employees, shifts, sites, roster] = await Promise.all([
    employeeRows(admin, tenantId, employeeIds),
    admin.from("wfm_shifts").select("id, start_time, crosses_midnight").eq("tenant_id", tenantId),
    admin.from("wfm_sites").select("id, lat, lng, radius_m").eq("tenant_id", tenantId),
    readAllPages((lo, hi) => admin.from("wfm_roster_assignments").select("employee_id, date, site_id").eq("tenant_id", tenantId).in("employee_id", employeeIds).gte("date", from).lte("date", to).order("id", { ascending: true }).range(lo, hi)),
  ]);
  const shiftById = new Map(((shifts.data ?? []) as { id: string; start_time: string; crosses_midnight: boolean }[]).map((s) => [s.id, s]));
  const pinById = new Map(((sites.data ?? []) as { id: string; lat: number; lng: number; radius_m: number }[]).map((s) => [s.id, { lat: s.lat, lng: s.lng, radius_m: s.radius_m }]));
  const homeOf = new Map(employees.map((e) => [e.id, e]));
  const rosterSite = new Map(((roster.data ?? []) as { employee_id: string; date: string; site_id: string }[]).map((r) => [`${r.employee_id}|${r.date}`, r.site_id]));

  const events: EventLike[] = [];
  for (let i = 0; i < employeeIds.length; i += 100) {
    const batch = employeeIds.slice(i, i + 100);
    const { data } = await readAllPages<EventLike>((lo, hi) => admin.from("wfm_presence_events")
      .select("employee_id, ts, flags, geo_lat, geo_lng")
      .eq("tenant_id", tenantId).in("employee_id", batch).in("kind", ["check_in", "check_out"]).is("superseded_by", null)
      .gte("ts", `${addDay(from, -PAD_DAYS)}T00:00:00Z`).lte("ts", `${addDay(to, PAD_DAYS + 1)}T00:00:00Z`)
      .order("ts", { ascending: true }).order("id", { ascending: true }).range(lo, hi));
    events.push(...(data ?? []));
  }

  return flagRowsFromEvents(events, {
    timezone: config.timezone, from, to,
    shiftOf: (id) => { const sid = homeOf.get(id)?.shift_id; const s = sid ? shiftById.get(sid) : null; return s ? { start_time: s.start_time, crosses_midnight: s.crosses_midnight } : null; },
    siteFor: (id, date) => { const sid = rosterSite.get(`${id}|${date}`) ?? homeOf.get(id)?.site_id ?? null; return sid ? pinById.get(sid) ?? null : null; },
  });
}

/** The site's standing shift: the most common shift among the people homed there. Null when nobody has one. */
async function standingShift(admin: SupabaseClient, tenantId: string, siteId: string): Promise<{ shift_start: string | null; grace_minutes: number | null }> {
  const { data } = await admin.from("employees").select("shift_id").eq("tenant_id", tenantId).eq("site_id", siteId).eq("status", "active").not("shift_id", "is", null).limit(1000);
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as { shift_id: string }[]) counts.set(r.shift_id, (counts.get(r.shift_id) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  if (!top) return { shift_start: null, grace_minutes: null };
  const { data: shift } = await admin.from("wfm_shifts").select("start_time, grace_minutes").eq("tenant_id", tenantId).eq("id", top).maybeSingle();
  const s = shift as { start_time: string; grace_minutes: number } | null;
  return { shift_start: s ? s.start_time.slice(0, 5) : null, grace_minutes: s?.grace_minutes ?? null };
}

/** The reads the Attendance engine is given: the tenant is closed over, never an argument. */
export function attendanceReads(admin: SupabaseClient, tenantId: string): AttendanceReads {
  return {
    async getConfig(): Promise<AttendanceConfigLike> {
      const c = await getWfmConfig(admin, tenantId);
      return { timezone: c.timezone, week_off_days: c.week_off_days, type_rules: c.type_rules, employment_types: c.employment_types };
    },
    async listSiteIds() {
      const { data } = await admin.from("wfm_sites").select("id").eq("tenant_id", tenantId).eq("active", true).order("id", { ascending: true });
      return ((data ?? []) as { id: string }[]).map((r) => r.id);
    },
    async getSite(siteId): Promise<SiteInfoLike | null> {
      const { data } = await admin.from("wfm_sites").select("id, radius_m").eq("tenant_id", tenantId).eq("id", siteId).eq("active", true).maybeSingle();
      if (!data) return null;
      return { id: (data as { id: string }).id, radius_m: (data as { radius_m: number }).radius_m, ...(await standingShift(admin, tenantId, siteId)) };
    },
    async listSiteEmployeeIds(siteId, from, to) {
      const [home, rostered] = await Promise.all([
        readAllPages<{ id: string }>((lo, hi) => admin.from("employees").select("id").eq("tenant_id", tenantId).eq("site_id", siteId).eq("status", "active").order("id", { ascending: true }).range(lo, hi)),
        readAllPages<{ employee_id: string }>((lo, hi) => admin.from("wfm_roster_assignments").select("employee_id").eq("tenant_id", tenantId).eq("site_id", siteId).gte("date", from).lte("date", to).order("id", { ascending: true }).range(lo, hi)),
      ]);
      const ids = new Set<string>((home.data ?? []).map((r) => r.id));
      // A roster row names a person, but only an active one of THIS workspace counts.
      const extra = [...new Set((rostered.data ?? []).map((r) => r.employee_id))].filter((id) => !ids.has(id));
      for (let i = 0; i < extra.length; i += 200) {
        const { data: active } = await admin.from("employees").select("id").eq("tenant_id", tenantId).eq("status", "active").in("id", extra.slice(i, i + 200));
        for (const r of (active ?? []) as { id: string }[]) ids.add(r.id);
      }
      return [...ids].sort();
    },
    async getSummaryForRange(from, to, employeeIds) {
      const rows = await getSummaryForRange(tenantId, from, to, employeeIds);
      return rows as SummaryRowLike[] | null;
    },
    getPunchFlagsForRange: (from, to, employeeIds) => getPunchFlagsForRange(admin, tenantId, from, to, employeeIds),
  };
}

// ── Who is addressed, and the names put back for a permitted viewer ────────────────────────────────────────────────────────

type SiteRow = { id: string; name: string; supervisor_id: string | null };

/**
 * The people in the chain of command of a site, as login user ids: the site's supervisor, its extra approvers (0124, empty while pending) and every
 * manager above the supervisor (employees.supervisor_id, walked up). The login of an employee is tenant_users.employee_id. Tenant-scoped throughout.
 */
export async function siteCommandChain(admin: SupabaseClient, tenantId: string, siteId: string): Promise<{ employeeId: string; userId: string }[]> {
  const { data: site } = await admin.from("wfm_sites").select("id, name, supervisor_id").eq("tenant_id", tenantId).eq("id", siteId).maybeSingle();
  const first: string[] = [];
  const supervisor = (site as SiteRow | null)?.supervisor_id;
  if (supervisor) first.push(supervisor);
  const { data: approvers, error } = await admin.from("wfm_site_approvers").select("employee_id").eq("tenant_id", tenantId).eq("site_id", siteId);
  if (!error) for (const r of (approvers ?? []) as { employee_id: string }[]) first.push(r.employee_id);

  const chain = new Set<string>(first);
  let frontier = [...first];
  for (let depth = 0; depth < 12 && frontier.length > 0; depth++) {
    const { data } = await admin.from("employees").select("id, supervisor_id").eq("tenant_id", tenantId).in("id", frontier);
    const next = ((data ?? []) as { id: string; supervisor_id: string | null }[]).map((r) => r.supervisor_id).filter((id): id is string => !!id && !chain.has(id));
    next.forEach((id) => chain.add(id));
    frontier = next;
  }
  if (chain.size === 0) return [];
  const { data: users } = await admin.from("tenant_users").select("user_id, employee_id").eq("tenant_id", tenantId).in("employee_id", [...chain]);
  return ((users ?? []) as { user_id: string; employee_id: string }[]).map((u) => ({ employeeId: u.employee_id, userId: u.user_id }));
}

/** The workspace admins as login user ids: who is addressed when a site has no supervisor or approver set, so a suggestion never lands with nobody. */
export async function tenantAdminUserIds(admin: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("role", "admin").limit(50);
  return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
}

/** Display names for ids of THIS workspace: employees "First Last", sites by name. Used only when a permitted viewer's screen is built. */
export async function namesForAliases(admin: SupabaseClient, tenantId: string, employeeIds: string[], siteIds: string[]): Promise<{ employees: Map<string, string>; sites: Map<string, string> }> {
  const employees = new Map<string, string>();
  const sites = new Map<string, string>();
  if (employeeIds.length > 0) {
    const { data } = await admin.from("employees").select("id, first_name, last_name").eq("tenant_id", tenantId).in("id", employeeIds.slice(0, 200));
    for (const r of (data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) employees.set(r.id, [r.first_name, r.last_name].filter(Boolean).join(" ") || "Employee");
  }
  if (siteIds.length > 0) {
    const { data } = await admin.from("wfm_sites").select("id, name").eq("tenant_id", tenantId).in("id", siteIds.slice(0, 50));
    for (const r of (data ?? []) as { id: string; name: string }[]) sites.set(r.id, r.name);
  }
  return { employees, sites };
}
