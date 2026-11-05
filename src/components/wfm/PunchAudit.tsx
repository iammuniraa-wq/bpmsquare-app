"use client";

import { useEffect, useState } from "react";
import { c, statusInk } from "@/lib/theme";
import Pill from "@/components/Pill";

type PunchEvent = {
  id: string;
  kind: "check_in" | "check_out" | "break_start" | "break_end";
  ts: string;
  source: string;
  site_name: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_accuracy_m: number | null;
  within_geofence: boolean | null;
  geo_address: string | null;
  selfie_url: string | null;
  flags?: { face_verified?: boolean; face_mismatch?: boolean; face_unreadable?: boolean; low_accuracy?: boolean } | null;
  /** The site's own pin, sent by the route only for a punch with no GPS fix (a kiosk punch). Not a GPS fix. */
  site_pin?: { lat: number; lng: number; name: string; address: string | null } | null;
};

const KIND_LABEL: Record<PunchEvent["kind"], string> = {
  check_in: "Check in", check_out: "Check out", break_start: "Break start", break_end: "Break end",
};

const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

const DAY_MS = 24 * 60 * 60 * 1000;
const mapLink = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/** What the selfie box says when there is no image. A punch older than the
 *  workspace's retention window had its selfie purged on purpose (the cron
 *  keeps the punch and its location), which is not the same as never having
 *  had one. A supervisor correction never has a selfie. */
export function selfieNote(e: Pick<PunchEvent, "ts" | "source">, retentionDays: number | null | undefined, now: number = Date.now()): string {
  if (e.source !== "correction" && retentionDays && retentionDays > 0 && new Date(e.ts).getTime() < now - retentionDays * DAY_MS) {
    return `Selfie removed after ${retentionDays} days`;
  }
  return "no selfie";
}

/**
 * The audit trail behind a punch: the selfie that was captured and where it
 * was taken. Selfies come back as short-lived signed URLs (the bucket is
 * private -- see 0062), so this component always fetches fresh rather than
 * caching a URL that will expire.
 *
 * Location shows the resolved street address (reverse-geocoded via Ola Maps
 * and cached on the row -- see lib/wfm/geocode.ts), with the raw coordinates
 * and a map link underneath so the underlying evidence is always visible and
 * an address is never the only record of where someone was.
 */
export default function PunchAudit({
  employeeId, date, canFlag, onFlag,
}: {
  employeeId: string;
  date?: string;
  /** Supervisor context only (Live Board) — never shown on an employee's own view. */
  canFlag?: boolean;
  onFlag?: (event: { id: string; kind: PunchEvent["kind"]; ts: string }) => void;
}) {
  const [events, setEvents] = useState<PunchEvent[] | null>(null);
  const [retentionDays, setRetentionDays] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setEvents(null);
    setError("");
    const params = new URLSearchParams({ employee_id: employeeId });
    if (date) params.set("date", date);
    fetch(`/api/wfm/presence?${params}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) { setError(j.error ?? "Could not load punches"); return; }
        setRetentionDays(typeof j.selfie_retention_days === "number" ? j.selfie_retention_days : null);
        setEvents(j.events ?? []);
      })
      .catch(() => setError("Network error"));
  }, [employeeId, date]);

  if (error) return <div style={{ fontSize: 12, color: statusInk.bad, padding: "8px 0" }}>{error}</div>;
  if (!events) return <div style={{ fontSize: 12, color: c.hint, padding: "8px 0" }}>Loading punches…</div>;
  return <PunchList events={events} retentionDays={retentionDays} canFlag={canFlag} onFlag={onFlag} />;
}

/** The loaded list, split from the fetch so the wording per punch source can be rendered and tested on its own. */
export function PunchList({
  events, retentionDays = null, canFlag, onFlag, now,
}: {
  events: PunchEvent[];
  retentionDays?: number | null;
  canFlag?: boolean;
  onFlag?: (event: { id: string; kind: PunchEvent["kind"]; ts: string }) => void;
  now?: number;
}) {
  if (events.length === 0) return <div style={{ fontSize: 12, color: c.hint, padding: "8px 0" }}>No punches on this day.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
      {/* Newest first. The route returns the day in chronological order --
          which is what a day's SEQUENCE needs, so that contract is left
          alone -- but on screen the punch someone just made should be the
          one they see, not the bottom of a growing list. Reversed here, on
          a copy, so the fetched array is never mutated. */}
      {[...events].reverse().map((e) => (
        <div key={e.id} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0", borderBottom: `1px solid ${c.line}` }}>
          {e.selfie_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <a href={e.selfie_url} target="_blank" rel="noopener noreferrer" title="Open full size">
              <img
                src={e.selfie_url}
                alt={`${KIND_LABEL[e.kind]} selfie`}
                style={{ width: 56, height: 72, objectFit: "cover", borderRadius: 8, border: `1px solid ${c.line}`, display: "block" }}
              />
            </a>
          ) : (
            <div style={{
              width: 56, height: 72, borderRadius: 8, border: `1px dashed ${c.line}`, flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, color: c.hint, textAlign: "center", padding: 4,
            }}>
              {selfieNote(e, retentionDays, now)}
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: c.ink }}>{KIND_LABEL[e.kind]}</span>
              <span style={{ color: c.hint }}>{fmtTime(e.ts)}</span>
              {e.source !== "web_selfie" && <Pill label={e.source === "correction" ? "Corrected" : e.source === "kiosk_face" ? "Kiosk" : "Manual"} tone={e.source === "kiosk_face" ? "blue" : "purple"} />}
              {e.within_geofence === true && <Pill label={e.site_name ?? "On site"} tone="green" />}
              {e.within_geofence === false && <Pill label="Outside geofence" tone="amber" />}
              {e.flags?.face_verified && <Pill label="Face ✓" tone="green" />}
              {e.flags?.face_mismatch && <Pill label="Face mismatch" tone="red" />}
              {e.flags?.face_unreadable && <Pill label="Face unreadable" tone="amber" />}
              {e.flags?.low_accuracy && <Pill label="Location unreliable" tone="amber" />}
              {canFlag && onFlag && (
                <button
                  type="button"
                  onClick={() => onFlag({ id: e.id, kind: e.kind, ts: e.ts })}
                  style={{
                    marginLeft: "auto", fontSize: 10.5, fontWeight: 600, color: statusInk.warn,
                    background: "none", border: `1px solid ${statusInk.warn}55`, borderRadius: 6,
                    padding: "2px 8px", cursor: "pointer",
                  }}
                >
                  ⚑ Flag for review
                </button>
              )}
            </div>

            {e.geo_lat != null && e.geo_lng != null ? (
              <>
                {e.geo_address && (
                  <div style={{ marginTop: 4, color: c.ink, fontSize: 12 }}>📍 {e.geo_address}</div>
                )}
                <div style={{ marginTop: 3, color: c.muted, fontSize: 11.5 }}>
                  {e.geo_lat.toFixed(5)}, {e.geo_lng.toFixed(5)}
                  {e.geo_accuracy_m != null && <span style={{ color: c.hint }}> · ±{Math.round(e.geo_accuracy_m)}m</span>}
                  {" · "}
                  <a
                    href={mapLink(e.geo_lat, e.geo_lng)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}
                  >
                    View on map ↗
                  </a>
                </div>
              </>
            ) : e.source === "kiosk_face" ? (
              // A kiosk is a fixed device: its punches never carry a GPS fix
              // by design, so this is neutral, not a fault.
              <>
                <div style={{ marginTop: 4, color: c.ink, fontSize: 12 }}>
                  Recorded at the kiosk{(e.site_pin?.name ?? e.site_name) ? ` at ${e.site_pin?.name ?? e.site_name}` : ""}
                </div>
                {e.site_pin && (
                  <>
                    {e.site_pin.address && <div style={{ marginTop: 3, color: c.muted, fontSize: 12 }}>{e.site_pin.address}</div>}
                    <div style={{ marginTop: 3, color: c.muted, fontSize: 11.5 }}>
                      Site location (not a GPS fix): {e.site_pin.lat.toFixed(5)}, {e.site_pin.lng.toFixed(5)}
                      {" · "}
                      <a
                        href={mapLink(e.site_pin.lat, e.site_pin.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}
                      >
                        View on map ↗
                      </a>
                    </div>
                  </>
                )}
              </>
            ) : e.source === "correction" ? (
              <div style={{ marginTop: 4, fontSize: 11.5, color: c.muted }}>Corrected by a supervisor: no location recorded</div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 11.5, color: statusInk.warn }}>No location captured</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
