"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import StatusPill from "@/components/ui/StatusPill";
import { RecordList, RecordRow } from "@/components/settings/RecordRows";
import { SettingsHeaderActions } from "@/components/settings/SettingsHeaderActions";
import type { WfmSite } from "@/lib/wfm/types";
import { typeLabel } from "@/lib/typeScale";

const SiteMapPicker = dynamic(() => import("@/components/wfm/SiteMapPicker"), { ssr: false });

type EmployeeOption = {
  id: string;
  first_name: string;
  last_name: string;
  employee_code: string | null;
  wfm_role: string;
  status: string;
};

const lbl: React.CSSProperties = { ...typeLabel, display: "block", marginBottom: 5 };
const inp: React.CSSProperties = {
  width: "100%", padding: "8px 11px", fontSize: 13,
  border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none", boxSizing: "border-box",
};
const btn: React.CSSProperties = {
  padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff",
};

function personName(e: { first_name: string; last_name: string }): string {
  return [e.first_name, e.last_name].filter(Boolean).join(" ");
}

export default function SitesClient({ canEdit }: { canEdit: boolean }) {
  const [sites, setSites] = useState<WfmSite[]>([]);
  const [people, setPeople] = useState<EmployeeOption[]>([]);
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const blank = { name: "", lat: "", lng: "", radius_m: "150", supervisor_id: "" };
  const [siteForm, setSiteForm] = useState(blank);
  // Extra approvers are a list, so they sit beside the string-keyed form
  // rather than being squeezed into it.
  const [approverIds, setApproverIds] = useState<string[]>([]);

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
  // Extra approvers (0124) count: a site run entirely by named approvers and
  // no single supervisor is covered, and warning about it would be wrong.
  const unsupervised = useMemo(
    () => sites.filter((s) => s.active && !s.supervisor_id && (s.approver_ids ?? []).length === 0),
    [sites]
  );

  async function send(url: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setOkMsg("");
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
      // The site's own supervisor is never also listed as an extra approver --
      // they already approve by virtue of running the site, and showing them
      // twice invites someone to "remove" them here and assume it took effect.
      approver_ids: approverIds.filter((id) => id !== siteForm.supervisor_id),
    };
    const wasEditing = !!editingId;
    const ok = editingId
      ? await send(`/api/wfm/sites/${editingId}`, payload, "PATCH")
      : await send("/api/wfm/sites", payload);
    if (ok) {
      setSiteForm(blank); setApproverIds([]); setAdding(false); setEditingId(null);
      setOkMsg(wasEditing ? `Site "${payload.name}" updated.` : `Site "${payload.name}" created.`);
    }
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
    setApproverIds(s.approver_ids ?? []);
  }

  function cancelEdit() {
    setSiteForm(blank); setApproverIds([]); setAdding(false); setEditingId(null); setError("");
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
              <div className="bpm-t-help" style={{ marginTop: 2 }}>
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

          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
            <label style={lbl}>Others who can also approve here</label>
            <div className="bpm-t-help" style={{ marginBottom: 8, maxWidth: 720 }}>
              Optional. Anyone ticked here approves this site&apos;s leave, comp-off, sick leave,
              work-from-home, overtime and corrections alongside the supervisor — so requests
              don&apos;t sit waiting when one person is away. They see this site&apos;s people, and
              nothing else changes about their access.
            </div>
            {activePeople.length === 0 ? (
              <div className="bpm-t-help">No active employees to choose from yet.</div>
            ) : (
              <div style={{
                maxHeight: 200, overflowY: "auto", border: `1px solid ${c.line}`,
                borderRadius: 8, padding: "6px 4px",
              }}>
                {activePeople
                  .filter((p) => p.id !== siteForm.supervisor_id)
                  .map((p) => (
                    <label
                      key={p.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "6px 8px", fontSize: 12.5, color: c.ink, cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={approverIds.includes(p.id)}
                        onChange={(e) =>
                          setApproverIds((prev) =>
                            e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                          )
                        }
                      />
                      <span>
                        {personName(p)}
                        {p.employee_code && <span style={{ color: c.hint }}> · {p.employee_code}</span>}
                      </span>
                    </label>
                  ))}
              </div>
            )}
            {siteForm.supervisor_id && (
              <div className="bpm-t-help" style={{ marginTop: 6 }}>
                The supervisor you picked above already approves for this site, so they aren&apos;t listed here.
              </div>
            )}
          </div>

          <div className="bpm-t-help" style={{ marginTop: 8 }}>
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
      {okMsg && (
        <div style={{ ...cardStyle, marginBottom: 14, color: "#1d9e75", fontSize: 12.5, fontWeight: 600 }}>✓ {okMsg}</div>
      )}

      {unsupervised.length > 0 && (
        <div style={{
          ...cardStyle, marginBottom: 14, borderLeft: `3px solid ${pillar.amber.base}`,
          fontSize: 12.5, color: c.ink,
        }}>
          <strong>{unsupervised.length} site{unsupervised.length === 1 ? " has" : "s have"} no supervisor.</strong>{" "}
          Overtime, leave and correction requests from people working at{" "}
          {unsupervised.map((s) => s.name).join(", ")} have nobody to approve them.
          Assign a supervisor to each.
        </div>
      )}

      {canEdit && (
        <SettingsHeaderActions>
          <Button variant="primary" onClick={() => { setAdding(true); setEditingId(null); setSiteForm(blank); setApproverIds([]); setError(""); }}>
            + New site
          </Button>
        </SettingsHeaderActions>
      )}

      <div className="bpm-t-help" style={{ marginBottom: 12, maxWidth: 720 }}>
        A site is a place people punch in at. Its <strong>radius</strong> is the geofence — how far
        from the pin a punch still counts as on-site. Its <strong>supervisor</strong> approves the
        overtime, leave and corrections of everyone assigned to work there, and you can name
        extra approvers alongside them so requests don&apos;t wait when one person is away.
      </div>

      <RecordList
        empty={
          <EmptyState
            title="No sites yet"
            text="Until a site exists, punches are recorded without any location check."
            action={canEdit ? <Button variant="primary" onClick={() => setAdding(true)}>+ New site</Button> : undefined}
          />
        }
      >
        {sites.map((s) => {
          const alsoApprovers = (s.approver_ids ?? [])
            .map((id) => { const p = people.find((x) => x.id === id); return p ? personName(p) : null; })
            .filter(Boolean)
            .join(", ");
          return (
            <RecordRow
              key={s.id}
              title={s.name}
              dim={!s.active}
              status={<StatusPill label={s.active ? "Active" : "Inactive"} tone={s.active ? "green" : "red"} />}
              facts={[
                {
                  label: "Supervisor",
                  value: s.supervisor ? (
                    <>{personName(s.supervisor)}{s.supervisor.employee_code && <span style={{ color: c.hint }}> · {s.supervisor.employee_code}</span>}</>
                  ) : (s.approver_ids ?? []).length > 0 ? (
                    <span style={{ color: c.hint }}>No single supervisor</span>
                  ) : (
                    <span style={{ color: pillar.amber.fg, fontWeight: 600 }}>Not assigned</span>
                  ),
                },
                ...(alsoApprovers ? [{ label: "Also approve", value: alsoApprovers }] : []),
                { label: "Geofence", value: `${s.radius_m} m` },
                { label: "Location", value: `${Number(s.lat).toFixed(4)}, ${Number(s.lng).toFixed(4)}` },
              ]}
              menu={canEdit ? [
                { label: "Edit", onSelect: () => startEdit(s) },
                { label: s.active ? "Deactivate" : "Activate", onSelect: () => { void send(`/api/wfm/sites/${s.id}`, { active: !s.active }, "PATCH"); } },
              ] : undefined}
            />
          );
        })}
      </RecordList>
    </>
  );
}
