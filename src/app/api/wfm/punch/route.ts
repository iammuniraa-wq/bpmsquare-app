import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmEmployee, getWfmConfig, matchSite, dateKeyInTz } from "@/lib/wfm/server";
import { applyPunch, type PresenceKind, type PunchState, type WfmSite } from "@/lib/wfm/types";
import { computeDayHours } from "@/lib/wfm/hours";

const KINDS: PresenceKind[] = ["check_in", "check_out", "break_start", "break_end"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Offline punches sync late, so past timestamps are legitimate — but bound
// them so a wrong device clock can't write into the far past/future.
const MAX_PAST_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_MS = 5 * 60 * 1000;

function stateFromLastKind(kind: PresenceKind | null): PunchState {
  if (kind === "check_in" || kind === "break_end") return "in";
  if (kind === "break_start") return "break";
  return "out";
}

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
  const { tenantId, userId, employee } = ctx;

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
    return NextResponse.json(
      { error: `Cannot ${kind.replace("_", " ")} while ${state}`, state },
      { status: 409 }
    );
  }
  if (last && tsDate.getTime() <= new Date(last.ts).getTime()) {
    return NextResponse.json({ error: "Punch time predates your last punch" }, { status: 409 });
  }

  const { data: siteRows } = await admin
    .from("wfm_sites")
    .select("id, name, lat, lng, radius_m, active")
    .eq("tenant_id", tenantId)
    .eq("active", true);

  const lat = typeof geo?.lat === "number" ? geo.lat : null;
  const lng = typeof geo?.lng === "number" ? geo.lng : null;
  const accuracy = typeof geo?.accuracy_m === "number" ? geo.accuracy_m : null;
  const { site, within } = matchSite((siteRows ?? []) as WfmSite[], lat, lng);

  const flags: Record<string, unknown> = {};
  if (within === false) flags.outside_geofence = true;
  if (lat == null && (kind === "check_in" || kind === "check_out")) flags.no_location = true;

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

  // Today's running total (tenant timezone): now − first check_in of today.
  const config = await getWfmConfig(admin, tenantId);
  const todayKey = dateKeyInTz(tsDate, config.timezone);
  const dayStart = new Date(tsDate.getTime() - 36 * 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin
    .from("wfm_presence_events")
    .select("kind, ts")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employee.id)
    .is("superseded_by", null)
    .gte("ts", dayStart)
    .order("ts", { ascending: true });

  const todays = (recent ?? []).filter((e) => dateKeyInTz(new Date(e.ts), config.timezone) === todayKey);
  const hours = computeDayHours(todays as { kind: PresenceKind; ts: string }[], tsDate);

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
