import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee, getWfmConfig, matchSite, zonedTimestamp } from "@/lib/wfm/server";
import { getSupervisorEmails, sendWfmNotification, wfmUrl } from "@/lib/wfm/notify";
import { ROUTES } from "@/lib/constants";
import {
  applyPunch, stateFromLastKind, isOtKind, PUNCH_KIND_GROUP, PUNCH_KIND_LABEL,
  type PresenceKind, type WfmSite,
} from "@/lib/wfm/types";
import { computeDayHours, shiftDayKey } from "@/lib/wfm/hours";

const KINDS: PresenceKind[] = [
  "check_in", "check_out", "break_start", "break_end",
  "ot_in", "ot_out",
  "mobile_work_start", "mobile_work_end",
  "business_trip_start", "business_trip_end",
];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Offline punches sync late, so past timestamps are legitimate — but bound
// them so a wrong device clock can't write into the far past/future.
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

// POST /api/wfm/punch — record one presence event. Idempotent on the
// client-generated event id (offline sync retries). Selfie is uploaded
// separately afterwards (POST /api/wfm/punch/selfie) so the punch itself
// is never blocked on a slow upload.
export async function POST(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfmEmployee();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { supabase, tenantId, userId, employee } = ctx;

  if (!employee.consent_recorded_at) {
    return NextResponse.json({ error: "Consent required before punching" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const { id, kind, ts, geo } = body as {
    id?: string;
    kind?: PresenceKind;
    ts?: string;
    geo?: { lat?: number; lng?: number; accuracy_m?: number } | null;
  };

  if (!id || !UUID_RE.test(id)) {
    return NextResponse.json({ error: "id must be a client-generated UUID" }, { status: 400 });
  }
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }
  const tsDate = ts ? new Date(ts) : new Date();
  if (isNaN(tsDate.getTime())) {
    return NextResponse.json({ error: "Invalid ts" }, { status: 400 });
  }
  const drift = Date.now() - tsDate.getTime();
  if (drift > MAX_PAST_MS || drift < -MAX_FUTURE_MS) {
    return NextResponse.json({ error: "ts out of acceptable range" }, { status: 400 });
  }

  const admin = createAdminSupabase();

  // Idempotency: if this event id already exists (offline retry), succeed
  // without re-validating — the original insert already did.
  const { data: existing } = await admin
    .from("wfm_presence_events")
    .select("id, kind, ts, site_id, within_geofence")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true, event: existing });
  }

  // Validate the transition against the employee's current state.
  const { data: last } = await admin
    .from("wfm_presence_events")
    .select("kind, ts")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employee.id)
    .is("superseded_by", null)
    .order("ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  const state = stateFromLastKind((last?.kind as PresenceKind) ?? null);
  const next = applyPunch(state, kind);
  if (!next) {
    // Includes the client's "no OT between check-in and check-out" rule:
    // `ot` is only reachable from `out`, so ot_in while `in`/`break` lands here.
    return NextResponse.json(
      { error: `Cannot ${PUNCH_KIND_LABEL[kind].toLowerCase()} while ${state}`, state },
      { status: 409 }
    );
  }
  if (last && tsDate.getTime() <= new Date(last.ts).getTime()) {
    return NextResponse.json({ error: "Punch time predates your last punch" }, { status: 409 });
  }

  const [config, { data: shift }] = await Promise.all([
    getWfmConfig(admin, tenantId),
    employee.shift_id
      ? admin.from("wfm_shifts").select("name, start_time, grace_minutes, crosses_midnight").eq("id", employee.shift_id).eq("tenant_id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // An optional punch type this tenant hasn't switched on must be refused
  // server-side too -- the dropdown hides it, but the API is the real gate.
  const group = PUNCH_KIND_GROUP[kind];
  if (group && !config.punch_types[group]) {
    return NextResponse.json({ error: `${PUNCH_KIND_LABEL[kind]} is not enabled for this workspace` }, { status: 403 });
  }

  const lat = typeof geo?.lat === "number" ? geo.lat : null;
  const lng = typeof geo?.lng === "number" ? geo.lng : null;
  const accuracy = typeof geo?.accuracy_m === "number" ? geo.accuracy_m : null;

  // off: no geofence check attempted at all -- every punch lands with no
  // site/flag, same as a tenant with zero sites configured today.
  let site: WfmSite | null = null;
  let within: boolean | null = null;
  if (config.geofence_mode !== "off") {
    const { data: siteRows } = await admin
      .from("wfm_sites")
      .select("id, name, lat, lng, radius_m, active")
      .eq("tenant_id", tenantId)
      .eq("active", true);
    const matched = matchSite((siteRows ?? []) as WfmSite[], lat, lng);
    site = matched.site;
    within = matched.within;
  }

  if (config.geofence_mode === "block" && within === false) {
    return NextResponse.json(
      { error: "You're outside every configured site's geofence — move closer and try again." },
      { status: 409 }
    );
  }

  const flags: Record<string, unknown> = {};
  if (within === false) flags.outside_geofence = true;
  if (lat == null && !isOtKind(kind) && kind !== "break_start" && kind !== "break_end") flags.no_location = true;

  const { data: event, error } = await admin
    .from("wfm_presence_events")
    .insert({
      id,
      tenant_id: tenantId,
      employee_id: employee.id,
      ts: tsDate.toISOString(),
      kind,
      source: "web_selfie",
      site_id: within ? site!.id : null,
      geo_lat: lat,
      geo_lng: lng,
      geo_accuracy_m: accuracy,
      within_geofence: within,
      flags,
      created_by: userId,
    })
    .select("id, kind, ts, site_id, within_geofence")
    .single();

  if (error) {
    // 23505 = another retry of the same id won the race — idempotent success.
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true, event: { id, kind, ts: tsDate.toISOString() } });
    }
    console.error("wfm punch insert failed:", error.message);
    return NextResponse.json({ error: "Could not record punch" }, { status: 500 });
  }

  // Closing an OT stretch creates its payable session row. Done here (at
  // punch time) rather than derived at read time because the session must
  // remember the day it STARTED on -- an OT stretch that runs past midnight
  // is one payable block, and re-deriving it from per-day event buckets
  // later would split it in two. Pending until a supervisor approves.
  if (kind === "ot_out") {
    const { data: openOt } = await admin
      .from("wfm_presence_events")
      .select("id, ts")
      .eq("tenant_id", tenantId)
      .eq("employee_id", employee.id)
      .eq("kind", "ot_in")
      .is("superseded_by", null)
      .lt("ts", tsDate.toISOString())
      .order("ts", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openOt) {
      const startedAt = new Date(openOt.ts);
      const otMinutes = Math.max(0, Math.round((tsDate.getTime() - startedAt.getTime()) / 60000));
      const { error: otErr } = await admin.from("wfm_ot_sessions").insert({
        tenant_id: tenantId,
        employee_id: employee.id,
        ot_date: shiftDayKey(startedAt, config.timezone, shift),
        start_event_id: openOt.id,
        end_event_id: event.id,
        started_at: startedAt.toISOString(),
        ended_at: tsDate.toISOString(),
        minutes: otMinutes,
        status: "pending",
      });
      // 23505 = the unique index on end_event_id caught an offline-sync
      // replay of this same ot_out; the session already exists.
      if (otErr && (otErr as { code?: string }).code !== "23505") {
        console.error("wfm ot session insert failed:", otErr.message);
      }
    }
  }

  // Today's running total (tenant timezone): now − first check_in of today.
  const todayKey = shiftDayKey(tsDate, config.timezone, shift);
  const dayStart = new Date(tsDate.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from("wfm_presence_events")
    .select("kind, ts")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employee.id)
    .is("superseded_by", null)
    .gte("ts", dayStart)
    .order("ts", { ascending: true });

  const todays = (recent ?? []).filter((e) => shiftDayKey(new Date(e.ts), config.timezone, shift) === todayKey);
  const hours = computeDayHours(todays as { kind: PresenceKind; ts: string }[], tsDate);

  // Late-arrival notification: only on the shift-day's FIRST check_in, so a
  // later break/check_out on the same day never re-fires it.
  if (
    config.notifications.late_arrival &&
    kind === "check_in" &&
    shift &&
    todays.filter((e) => e.kind === "check_in").length === 1
  ) {
    const graceEnd = zonedTimestamp(todayKey, shift.start_time, config.timezone).getTime() + shift.grace_minutes * 60 * 1000;
    if (tsDate.getTime() > graceEnd) {
      const empName = [employee.first_name, employee.last_name].filter(Boolean).join(" ");
      getSupervisorEmails(admin, tenantId, employee.id).then((emails) =>
        sendWfmNotification({
          sessionSupabase: supabase,
          tenantId,
          toEmails: emails,
          subject: `Late arrival — ${empName}`,
          text: `${empName} checked in late on ${todayKey} (shift ${shift.name}, starts ${shift.start_time.slice(0, 5)}).\n\nView the live board: ${wfmUrl(ROUTES.wfmLiveBoard)}`,
          relatedObjectType: "wfm_presence_events",
          relatedObjectId: event.id,
          relatedObjectLabel: `${empName} — ${todayKey}`,
        })
      ).catch(() => {});
    }
  }

  return NextResponse.json({
    ok: true,
    event,
    state: next,
    site_name: within ? site!.name : null,
    within_geofence: within,
    running_minutes: config.deduct_breaks ? hours.net_minutes : hours.gross_minutes,
    break_minutes: hours.break_minutes,
  });
}
