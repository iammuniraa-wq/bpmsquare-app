"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import type { WfmSite } from "@/lib/wfm/types";

const SiteMapPicker = dynamic(() => import("@/components/wfm/SiteMapPicker"), { ssr: false });

type EmployeeOption = {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string | null;
  wfm_role: string;
  status: string;
};

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
const btnLink: React.CSSProperties = {
  border: "none", background: "none", color: "var(--tenant-accent, #378ADD)",
  fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: "8px 6px",
};

function personName(e: { first_name: string; last_name: string }): string {
  return [e.first_name, e.last_name].filter(Boolean).join(" ");
}

export default function SitesClient({ canEdit }: { canEdit: boolean }) {
  const [sites, setSites] = useState<WfmSite[]>([]);
  const [people, setPeople] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const blank = { name: "", lat: "", lng: "", radius_m: "150", supervisor_id: "" };
  const [siteForm, setSiteForm] = useState(blank);

  const load = useCallback(async () => {
    const [sitesRes, empRes] = await Promise.all([
      fetch("/api/wfm/sites"),
      fetch("/api/wfm/employees"),
    ]);
    if (sitesRes.ok) setSites(await sitesRes.json());
    else setError((await sitesRes.json()).error ?? "Failed to load sites");

    // Failing quietly here is what makes the supervisor dropdown look empty
    // when the real problem is that the employee list never loaded.
    if (empRes.ok) {
      const rows = await empRes.json();
      setPeople(Array.isArray(rows) ? rows : (rows.employees ?? []));
    } else {
      const json = await empRes.json().catch(() => ({}));
      setError(json.error ?? "Couldn't load the employee list — the supervisor dropdown will be empty.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const activePeople = useMemo(() => people.filter((p) => p.status === "active"), [people]);

  // A site with nobody assigned has no approver at all -- overtime, leave and
  // corrections from its staff reach nobody. Deliberately not escalated to a
  // tenant admin behind the scenes, so surfacing it here is the whole safety net.
  const unsupervised = useMemo(
    () => sites.filter((s) => s.active && !s.supervisor_id),
    [sites]
  );

  async function send(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
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

  async function saveSite() {
    const lat = parseFloat(siteForm.lat);
    const lng = parseFloat(siteForm.lng);
    if (!siteForm.name.trim() || isNaN(lat) || isNaN(lng)) {
      setError("A site needs a name and a location — click the map, or type the latitude and longitude.");
      return;
    }
    const payload = {
      name: siteForm.name,
      lat,
      lng,
      radius_m: parseInt(siteForm.radius_m) || 150,
      supervisor_id: siteForm.supervisor_id || null,
    };
    const ok = editingId
      ? await send(`/api/wfm/sites/${editingId}`, payload, "PATCH")
      : await send("/api/wfm/sites", payload);
    if (ok) { setSiteForm(blank); setAdding(false); setEditingId(null); }
  }

  function startEdit(s: WfmSite) {
    setEditingId(s.id);
    setAdding(true);
    setError("");
    setSiteForm({
      name: s.name,
      lat: String(s.lat),
      lng: String(s.lng),
      radius_m: String(s.radius_m),
      supervisor_id: s.supervisor_id ?? "",
    });
  }

  function cancelEdit() {
    setSiteForm(blank); setAdding(false); setEditingId(null); setError("");
  }

  const pickedLat = siteForm.lat ? parseFloat(siteForm.lat) : null;
  const pickedLng = siteForm.lng ? parseFloat(siteForm.lng) : null;

  // Add/Edit takes over the view rather than unfolding underneath the table.
  // Stacking the form below a growing list meant scrolling past every site to
  // reach the fields, and left the screen looking permanently "open".
  if (canEdit && adding) {
    return (
      <>
        {error && (
          <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>
        )}

        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>
                {editingId ? "Edit site" : "New site"}
              </div>
              <div style={{ fontSize: 12, color: c.muted, marginTop: 2 }}>
                The supervisor you pick approves overtime, leave and corrections for everyone working here.
              </div>
            </div>
            <button style={btn} onClick={cancelEdit}>← Back to sites</button>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={lbl}>Location — search an address or click the map</label>
            <SiteMapPicker
              lat={pickedLat}
              lng={pickedLng}
              onChange={(lat, lng) => setSiteForm((f) => ({ ...f, lat: lat.toFixed(6), lng: lng.toFixed(6) }))}
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label style={lbl}>Site name</label>
              <input style={inp} value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} placeholder="Workshop — Hosapete" />
            </div>

            <div style={{ flex: "1 1 240px" }}>
              <label style={lbl}>Supervisor</label>
              <select
                style={inp}
                value={siteForm.supervisor_id}
                onChange={(e) => setSiteForm({ ...siteForm, supervisor_id: e.target.value })}
                disabled={activePeople.length === 0}
              >
                <option value="">
                  {activePeople.length === 0 ? "No employees to choose from" : "— No supervisor —"}
                </option>
                {activePeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {personName(p)}{p.employee_code ? ` · ${p.employee_code}` : ""}
                    {p.wfm_role === "supervisor" ? "" : "  (will be given supervisor access)"}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: "0 1 130px" }}>
              <label style={lbl}>Geofence radius</label>
              <input style={inp} value={siteForm.radius_m} onChange={(e) => setSiteForm({ ...siteForm, radius_m: e.target.value })} placeholder="150" />
            </div>
            <div style={{ flex: "0 1 120px" }}>
              <label style={lbl}>Latitude</label>
              <input style={inp} value={siteForm.lat} onChange={(e) => setSiteForm({ ...siteForm, lat: e.target.value })} placeholder="15.2695" />
            </div>
            <div style={{ flex: "0 1 120px" }}>
              <label style={lbl}>Longitude</label>
              <input style={inp} value={siteForm.lng} onChange={(e) => setSiteForm({ ...siteForm, lng: e.target.value })} placeholder="76.3871" />
            </div>

            <button style={btnPrimary} disabled={busy} onClick={saveSite}>
              {editingId ? "Save changes" : "Add site"}
            </button>
            <button style={btn} disabled={busy} onClick={cancelEdit}>Cancel</button>
          </div>

          <div style={{ fontSize: 11.5, color: c.hint, marginTop: 8 }}>
            {activePeople.length === 0
              ? "There are no active employees yet — add people under Workforce → Employees, then come back and assign one here."
              : "Anyone chosen as a supervisor here is given supervisor access automatically — you don't need to change their role on the Employees screen as well."}
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      {error && (
        <div style={{ ...cardStyle, marginBottom: 14, color: "#ef4444", fontSize: 12.5 }}>{error}</div>
      )}

      {unsupervised.length > 0 && (
        <div style={{
          ...cardStyle, marginBottom: 14, borderLeft: `3px solid ${pillar.amber.base}`,
          fontSize: 12.5, color: c.ink,
        }}>
          <strong>{unsupervised.length} site{unsupervised.length === 1 ? " has" : "s have"} no supervisor.</strong>{" "}
          Overtime, leave and correction requests from people working at{" "}
          {unsupervised.map((s) => s.name).join(", ")} have nobody to approve them.
          Assign a supervisor below.
        </div>
      )}

      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <div style={{
          padding: "12px 12px 10px", borderBottom: `1px solid ${c.line}`,
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: c.ink }}>Sites</div>
            <div style={{ fontSize: 12, color: c.muted, marginTop: 3, maxWidth: 720 }}>
              A site is a place people punch in at. Its <strong>radius</strong> is the geofence — how far
              from the pin a punch still counts as on-site. Its <strong>supervisor</strong> approves the
              overtime, leave and corrections of everyone assigned to work there.
            </div>
          </div>
          {canEdit && (
            <button style={btnPrimary} onClick={() => { setAdding(true); setEditingId(null); setSiteForm(blank); setError(""); }}>
              + Add site
            </button>
          )}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Site</th>
              <th style={th}>Supervisor</th>
              <th style={th}>Geofence</th>
              <th style={th}>Location</th>
              <th style={th}>Status</th>
              {canEdit && <th style={th}></th>}
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id}>
                <td style={{ ...td, fontWeight: 600, color: c.ink }}>{s.name}</td>
                <td style={td}>
                  {s.supervisor ? (
                    <span style={{ color: c.ink }}>
                      {personName(s.supervisor)}
                      {s.supervisor.employee_code && (
                        <span style={{ color: c.hint, fontSize: 11.5 }}> · {s.supervisor.employee_code}</span>
                      )}
                    </span>
                  ) : (
                    <span style={{ color: pillar.amber.fg, fontWeight: 600 }}>Not assigned</span>
                  )}
                </td>
                <td style={td}>{s.radius_m} m</td>
                <td style={{ ...td, color: c.hint, fontSize: 11.5, whiteSpace: "nowrap" }}>
                  {Number(s.lat).toFixed(4)}, {Number(s.lng).toFixed(4)}
                </td>
                <td style={td}><Pill label={s.active ? "Active" : "Inactive"} tone={s.active ? "green" : "red"} /></td>
                {canEdit && (
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button style={btnLink} disabled={busy} onClick={() => startEdit(s)}>Edit</button>
                    <button
                      style={btnLink}
                      disabled={busy}
                      onClick={() => send(`/api/wfm/sites/${s.id}`, { active: !s.active }, "PATCH")}
                    >
                      {s.active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {sites.length === 0 && (
              <tr>
                <td style={{ ...td, color: c.hint }} colSpan={6}>
                  No sites yet. Add the first one below — until a site exists, punches are recorded
                  without any location check.
                </td>
              </tr>
            )}
          </tbody>
        </table>

      </section>
    </>
  );
}
