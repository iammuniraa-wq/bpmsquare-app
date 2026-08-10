"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import type { WfmSite } from "@/lib/wfm/types";

const SiteMapPicker = dynamic(() => import("@/components/wfm/SiteMapPicker"), { ssr: false });

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11.5, fontWeight: 600,
  color: c.muted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5,
};
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const th: React.CSSProperties = {
  textAlign: "left", color: c.hint, fontWeight: 500,
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, verticalAlign: "middle",
};
const btn: React.CSSProperties = {
  padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff",
};

export default function SitesClient({ canEdit }: { canEdit: boolean }) {
  const [sites, setSites] = useState<WfmSite[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [siteForm, setSiteForm] = useState({ name: "", lat: "", lng: "", radius_m: "150" });

  const load = useCallback(async () => {
    const res = await fetch("/api/wfm/sites");
    if (res.ok) setSites(await res.json());
    else setError((await res.json()).error ?? "Failed to load");
  }, []);

  useEffect(() => { load(); }, [load]);

  async function post(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Request failed"); return false; }
      await load();
      return true;
    } catch {
      setError("Network error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addSite() {
    const lat = parseFloat(siteForm.lat);
    const lng = parseFloat(siteForm.lng);
    if (!siteForm.name.trim() || isNaN(lat) || isNaN(lng)) {
      setError("Site needs a name and numeric latitude/longitude — pick a point on the map or type coordinates");
      return;
    }
    const ok = await post("/api/wfm/sites", {
      name: siteForm.name, lat, lng, radius_m: parseInt(siteForm.radius_m) || 150,
    });
    if (ok) setSiteForm({ name: "", lat: "", lng: "", radius_m: "150" });
  }

  const pickedLat = siteForm.lat ? parseFloat(siteForm.lat) : null;
  const pickedLng = siteForm.lng ? parseFloat(siteForm.lng) : null;

  return (
    <>
      {error && (
        <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>
      )}

      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, color: c.ink, borderBottom: `1px solid ${c.line}` }}>
          Sites
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Name</th>
              <th style={th}>Latitude</th>
              <th style={th}>Longitude</th>
              <th style={th}>Radius (m)</th>
              <th style={th}>Status</th>
              {canEdit && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td style={{ ...td, fontWeight: 600, color: c.ink }}>{s.name}</td>
                <td style={td}>{s.lat}</td>
                <td style={td}>{s.lng}</td>
                <td style={td}>{s.radius_m}</td>
                <td style={td}><Pill label={s.active ? "Active" : "Inactive"} tone={s.active ? "green" : "red"} /></td>
                {canEdit && (
                  <td style={td}>
                    <button
                      style={btn}
                      disabled={busy}
                      onClick={() => post(`/api/wfm/sites/${s.id}`, { active: !s.active }, "PATCH")}
                    >
                      {s.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {sites.length === 0 && (
              <tr><td style={{ ...td, color: c.hint }} colSpan={6}>No sites yet.</td></tr>
            )}
          </tbody>
        </table>
        {canEdit && (
          <div style={{ padding: 12 }}>
            <div style={{ marginBottom: 10 }}>
              <label style={lbl}>Pick location on map</label>
              <SiteMapPicker
                lat={pickedLat}
                lng={pickedLng}
                onChange={(lat, lng) => setSiteForm((f) => ({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6) }))}
              />
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: "1 1 160px" }}>
                <label style={lbl}>Name</label>
                <input style={inp} value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} placeholder="Workshop — Hosapete" />
              </div>
              <div style={{ flex: "0 1 130px" }}>
                <label style={lbl}>Latitude</label>
                <input style={inp} value={siteForm.lat} onChange={(e) => setSiteForm({ ...siteForm, lat: e.target.value })} placeholder="15.2695" />
              </div>
              <div style={{ flex: "0 1 130px" }}>
                <label style={lbl}>Longitude</label>
                <input style={inp} value={siteForm.lng} onChange={(e) => setSiteForm({ ...siteForm, lng: e.target.value })} placeholder="76.3871" />
              </div>
              <div style={{ flex: "0 1 100px" }}>
                <label style={lbl}>Radius (m)</label>
                <input style={inp} value={siteForm.radius_m} onChange={(e) => setSiteForm({ ...siteForm, radius_m: e.target.value })} />
              </div>
              <button style={btnPrimary} disabled={busy} onClick={addSite}>Add site</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
