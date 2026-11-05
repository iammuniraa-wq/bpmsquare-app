import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase-server";
import { requireWfm, getWfmConfig } from "@/lib/wfm/server";
import { resolveWfmScope } from "@/lib/wfm/scope";
import { shiftDayKey } from "@/lib/wfm/hours";
import { reverseGeocode, geocodingConfigured } from "@/lib/wfm/geocode";


// Capped per route, not via vercel.json. That config carried
// "src/app/api/wfm/**": { maxDuration: 60 } from 2026-10-03 and it never
// took effect -- on 2026-10-07 these routes still ran the full 300s during a
// Supabase connectivity blip, while /api/wfm/summary, the one route with this
// export, stopped at 60. The glob matches directories, not source files. A
// hung request holds a Fluid instance other requests are sharing, so this
// bounds the blast radius as much as the bill.
export const maxDuration = 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/wfm/presence?employee_id=&date=YYYY-MM-DD — one employee's punches
// for a shift-day, with the geo fix and a short-lived signed selfie URL for
// each. This is the audit view behind the live board and an employee's own
// timesheet: until now selfies and coordinates were captured and stored but
// had no way to be seen.
//
// Access: your own rows always; anyone else's only as a supervisor/admin --
// the same boundary 0063's RLS enforces at the row level.
export async function GET(request: NextRequest) {
  let ctx;
  try {
    ctx = await requireWfm();
  } catch (e: unknown) {
    const err = e as { status: number; message: string };
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const { tenantId, employee, isSupervisor } = ctx;

  const employeeId = request.nextUrl.searchParams.get("employee_id") ?? employee?.id;
  const date = request.nextUrl.searchParams.get("date");
  if (!employeeId) return NextResponse.json({ error: "No employee" }, { status: 400 });
  if (date && !DATE_RE.test(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  if (employeeId !== employee?.id) {
    if (!isSupervisor) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // Being a supervisor is no longer enough -- it has to be someone in your
    // own subtree. Selfies and GPS fixes are the most sensitive data in the
    // module, so a supervisor at another site must not reach them.
    const scope = await resolveWfmScope(ctx);
    if (!scope.unrestricted && !(scope.employeeIds ?? []).includes(employeeId)) {
      return NextResponse.json({ error: "That employee doesn't work at a site you supervise." }, { status: 403 });
    }
  }

  const admin = createAdminSupabase();
  const config = await getWfmConfig(admin, tenantId);

  const { data: emp } = await admin
    .from("employees")
    .select("id, first_name, last_name, employee_code, shift_id")
    .eq("id", employeeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!emp) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: shift } = emp.shift_id
    ? await admin.from("wfm_shifts").select("start_time, crosses_midnight").eq("id", emp.shift_id).eq("tenant_id", tenantId).maybeSingle()
    : { data: null };

  const dayKey = date ?? shiftDayKey(new Date(), config.timezone, shift);
  // Pad generously and then filter by shift-day, so a night shift's events
  // either side of midnight are attributed the same way as everywhere else.
  const from = new Date(`${dayKey}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${dayKey}T00:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 2);

  const { data: events } = await admin
    .from("wfm_presence_events")
    .select("id, kind, ts, source, site_id, geo_lat, geo_lng, geo_accuracy_m, within_geofence, selfie_path, geo_address, flags")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId)
    .is("superseded_by", null)
    .gte("ts", from.toISOString())
    .lt("ts", to.toISOString())
    .order("ts", { ascending: true });

  const dayEvents = (events ?? []).filter(
    (e) => shiftDayKey(new Date(e.ts as string), config.timezone, shift) === dayKey
  );

  const { data: sites } = await admin.from("wfm_sites").select("id, name, lat, lng").eq("tenant_id", tenantId);
  const siteName = new Map((sites ?? []).map((s) => [s.id as string, s.name as string]));
  const siteById = new Map((sites ?? []).map((s) => [s.id as string, s]));

  // A kiosk punch never carries a GPS fix (the device is fixed, so the punch
  // is stamped with the kiosk's site instead). For those the screen shows the
  // site's own pin, clearly labelled as the site and not a fix. The address
  // is looked up once per distinct site for this request, never per punch,
  // and lives only in this request (tenant-scoped data, so no shared cache).
  // Everything here runs after the scope check above, so a viewer never gets
  // the pin of a site belonging to an employee they cannot see.
  const hasFix = (e: { geo_lat: unknown; geo_lng: unknown }) => e.geo_lat != null && e.geo_lng != null;
  const pinSiteIds = [...new Set(
    dayEvents.filter((e) => !hasFix(e) && e.site_id && siteById.has(e.site_id as string)).map((e) => e.site_id as string)
  )];
  const siteAddress = new Map<string, string | null>();
  await Promise.all(
    pinSiteIds.map(async (id) => {
      const site = siteById.get(id)!;
      let address: string | null = null;
      if (geocodingConfigured()) {
        try {
          const r = await reverseGeocode(Number(site.lat), Number(site.lng));
          if (r.status === "ok") address = r.address;
        } catch {
          address = null;
        }
      }
      siteAddress.set(id, address);
    })
  );

  // Resolve any addresses we don't have yet, ONCE, and cache them on the
  // row. Doing it lazily on first view rather than at punch time keeps
  // punching instant (no provider round-trip in the critical path) and means
  // a punch nobody ever looks at costs nothing. A failure is left null so
  // it's retried next time; a genuine "no address here" is cached as "" so
  // it isn't.
  // "" counts as unresolved, not as resolved-to-nothing. Caching "" was a
  // trap: if the provider response were ever parsed wrongly, every viewed
  // punch would be permanently stamped "" and never retried, so fixing the
  // parser later would silently fix nothing. Treating "" as outstanding
  // makes the whole history self-heal on next view instead.
  const needAddress = dayEvents.filter(
    (e) => !e.geo_address && e.geo_lat != null && e.geo_lng != null
  );
  const resolved = new Map<string, string>();
  if (geocodingConfigured() && needAddress.length > 0) {
    await Promise.all(
      needAddress.map(async (e) => {
        const r = await reverseGeocode(Number(e.geo_lat), Number(e.geo_lng));
        if (r.status !== "ok") {
          // Both "unavailable" (call failed) and "empty" (nothing parsed out
          // of the response) are left unwritten so they retry. The reason is
          // logged because this is the ONLY place it surfaces -- the screen
          // itself falls back to coordinates without complaint, by design.
          // Deliberately does NOT log the coordinates -- exact lat/lng of a
          // named employee's punch is location PII, and platform logs are
          // retained and broadly readable. The event id + reason is enough
          // to diagnose; look up the row if the coordinate is needed.
          console.error(
            `[wfm/presence] no address for event ${e.id}: ` +
            (r.status === "unavailable" ? r.reason : "provider returned no parsable address")
          );
          return;
        }
        resolved.set(e.id as string, r.address);
        await admin
          .from("wfm_presence_events")
          .update({ geo_address: r.address })
          .eq("id", e.id)
          .eq("tenant_id", tenantId);
      })
    );
  }

  // Selfies live in a PRIVATE bucket (0062) -- they're DPDP-sensitive and
  // must never be publicly addressable. Mint a short-lived signed URL per
  // event instead; 5 minutes is enough to render the page and no longer.
  const withUrls = await Promise.all(
    dayEvents.map(async (e) => {
      let selfie_url: string | null = null;
      if (e.selfie_path) {
        const { data: signed } = await admin.storage.from("wfm").createSignedUrl(e.selfie_path as string, 300);
        selfie_url = signed?.signedUrl ?? null;
      }
      const address = resolved.get(e.id as string) ?? (e.geo_address as string | null);
      const pinSite = !hasFix(e) && e.site_id ? siteById.get(e.site_id as string) : undefined;
      return {
        id: e.id,
        kind: e.kind,
        ts: e.ts,
        source: e.source,
        site_name: e.site_id ? (siteName.get(e.site_id as string) ?? null) : null,
        geo_lat: e.geo_lat,
        geo_lng: e.geo_lng,
        geo_accuracy_m: e.geo_accuracy_m,
        within_geofence: e.within_geofence,
        geo_address: address || null,
        selfie_url,
        flags: e.flags ?? null,
        site_pin: pinSite
          ? {
              lat: Number(pinSite.lat),
              lng: Number(pinSite.lng),
              name: pinSite.name as string,
              address: siteAddress.get(e.site_id as string) ?? null,
            }
          : null,
      };
    })
  );

  return NextResponse.json({
    date: dayKey,
    employee: {
      id: emp.id,
      full_name: [emp.first_name, emp.last_name].filter(Boolean).join(" "),
      employee_code: emp.employee_code,
    },
    selfie_retention_days: config.selfie_retention_days,
    events: withUrls,
  });
}
