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
};

const KIND_LABEL: Record<PunchEvent["kind"], string> = {
  check_in: "Check in", check_out: "Check out", break_start: "Break start", break_end: "Break end",
};

const fmtTime = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

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
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ employee_id: employeeId });
    if (date) params.set("date", date);
    fetch(`/api/wfm/presence?${params}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) { setError(j.error ?? "Could not load punches"); return; }
        setEvents(j.events ?? []);
      })
      .catch(() => setError("Network error"));
  }, [employeeId, date]);

  if (error) return <div style={{ fontSize: 12, color: statusInk.bad, padding: "8px 0" }}>{error}</div>;
  if (!events) return <div style={{ fontSize: 12, color: c.hint, padding: "8px 0" }}>Loading punches…</div>;
  if (events.length === 0) return <div style={{ fontSize: 12, color: c.hint, padding: "8px 0" }}>No punches on this day.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
      {events.map((e) => (
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
              width: 56, height: 72, borderRadius: 8, border: `1px dashed ${c.line}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, color: c.hint, textAlign: "center", padding: 4,
            }}>
              no selfie
            </div>
          )}

          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600, color: c.ink }}>{KIND_LABEL[e.kind]}</span>
              <span style={{ color: c.hint }}>{fmtTime(e.ts)}</span>
              {e.source !== "web_selfie" && <Pill label={e.source === "correction" ? "Corrected" : "Manual"} tone="purple" />}
              {e.within_geofence === true && <Pill label={e.site_name ?? "On site"} tone="green" />}
              {e.within_geofence === false && <Pill label="Outside geofence" tone="amber" />}
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
                  ⚑ Flag for recheck
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
                    href={`https://www.google.com/maps/search/?api=1&query=${e.geo_lat},${e.geo_lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: c.accent, textDecoration: "none", fontWeight: 600 }}
                  >
                    View on map ↗
                  </a>
                </div>
              </>
            ) : (
              <div style={{ marginTop: 4, fontSize: 11.5, color: statusInk.warn }}>No location captured</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
