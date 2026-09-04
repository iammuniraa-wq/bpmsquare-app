"use client";

import { useCallback, useEffect, useState } from "react";
import { useFeel } from "@/components/FeelProvider";
import { c, statusInk } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import type { WfmSite } from "@/lib/wfm/types";

/**
 * Kiosk device registration (admin-only — the API enforces it; a
 * non-admin opening this tab just sees the error the route returns).
 * The device token is shown ONCE, at creation, in a copy box: we store
 * only its hash, so it can never be re-displayed — same contract as API
 * keys, and the copy explains that.
 */

type Device = {
  id: string;
  name: string;
  site_name: string | null;
  active: boolean;
  last_seen_at: string | null;
  created_at: string;
};

const inp: React.CSSProperties = {
  padding: "8px 11px", fontSize: 13, border: `1px solid ${c.line}`, borderRadius: 8,
  background: c.panel, color: c.ink, outline: "none",
};
const btn: React.CSSProperties = {
  padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8,
  border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  ...btn, background: "var(--tenant-accent, #378ADD)", borderColor: "transparent", color: "#fff",
};

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";

export default function KiosksClient() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [sites, setSites] = useState<WfmSite[]>([]);
  const [name, setName] = useState("");
  const [siteId, setSiteId] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [dRes, sRes] = await Promise.all([fetch("/api/wfm/kiosk/devices"), fetch("/api/wfm/sites")]);
    if (dRes.ok) setDevices(await dRes.json());
    else setError((await dRes.json()).error ?? "Failed to load");
    if (sRes.ok) setSites(await sRes.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function register() {
    if (!name.trim() || !siteId) { setError("Name and site are required"); return; }
    setBusy(true);
    setError("");
    setNewToken(null);
    try {
      const res = await fetch("/api/wfm/kiosk/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), site_id: siteId }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not register"); return; }
      setNewToken(json.token);
      setName("");
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const { confirm: feelConfirm } = useFeel();

  // Issue a fresh code for a kiosk that already exists, keeping its name,
  // site and history. Needed whenever a tablet loses its stored code (a
  // factory reset or cleared browser data) or the old code has been seen by
  // someone it shouldn't have. Previously both meant registering a brand-new
  // device and abandoning the old row.
  async function reissue(d: Device) {
    const ok = await feelConfirm({
      title: `Issue a new code for "${d.name}"?`,
      body: "The current code stops working immediately, so the tablet on the wall will ask to be registered again. Recorded punches are not affected.",
      confirmLabel: "Issue new code",
      tone: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError("");
    setNewToken(null);
    try {
      const res = await fetch("/api/wfm/kiosk/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: d.id }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Could not issue a new code"); return; }
      setNewToken(json.token);
      await load();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(d: Device) {
    if (!(await feelConfirm({ title: `Deactivate "${d.name}"?`, body: "The tablet stops working immediately.", confirmLabel: "Deactivate", tone: "danger" }))) return;
    setBusy(true);
    await fetch(`/api/wfm/kiosk/devices?id=${d.id}`, { method: "DELETE" });
    setBusy(false);
    await load();
  }

  return (
    <>
      <section style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: c.ink, marginBottom: 4 }}>Register a kiosk tablet</div>
        <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.55, marginBottom: 12 }}>
          On the tablet, open <b>{typeof location !== "undefined" ? location.origin : ""}/kiosk</b> in the browser
          (add it to the home screen for fullscreen), then paste the code generated here. Enrolled employees can
          then punch by face on it — no login on the device.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...inp, flex: "1 1 180px", maxWidth: 260 }} placeholder="Name — e.g. Main door" value={name} onChange={(e) => setName(e.target.value)} />
          <select style={inp} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">— site —</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button style={btnPrimary} disabled={busy} onClick={() => void register()}>Generate kiosk code</button>
        </div>
        {error && <div style={{ fontSize: 12.5, color: statusInk.bad, marginTop: 10 }}>{error}</div>}
        {newToken && (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: `1px solid ${statusInk.good}55`, background: `${statusInk.good}0d` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: c.ink, marginBottom: 6 }}>
              Kiosk code — shown only once. Paste it on the tablet now.
            </div>
            <code style={{ fontSize: 13, wordBreak: "break-all", color: c.ink }}>{newToken}</code>
            <div style={{ marginTop: 8 }}>
              <button style={btn} onClick={() => { void navigator.clipboard?.writeText(newToken); }}>Copy</button>
            </div>
          </div>
        )}
      </section>

      <section style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
        <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Name", "Site", "Status", "Last seen", "Registered", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", color: c.hint, fontWeight: 500, padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 11.5, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.id}>
                <td style={{ padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5, fontWeight: 600, color: c.ink }}>{d.name}</td>
                <td style={{ padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12.5 }}>{d.site_name ?? "—"}</td>
                <td style={{ padding: "9px 12px", borderBottom: `1px solid ${c.line}` }}>
                  <Pill label={d.active ? "Active" : "Deactivated"} tone={d.active ? "green" : "red"} />
                </td>
                <td style={{ padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12, color: c.muted }}>{fmt(d.last_seen_at)}</td>
                <td style={{ padding: "9px 12px", borderBottom: `1px solid ${c.line}`, fontSize: 12, color: c.muted }}>{fmt(d.created_at)}</td>
                <td style={{ padding: "9px 12px", borderBottom: `1px solid ${c.line}` }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button style={btn} disabled={busy} onClick={() => void reissue(d)}>New code</button>
                    {d.active && <button style={btn} disabled={busy} onClick={() => void deactivate(d)}>Deactivate</button>}
                  </div>
                </td>
              </tr>
            ))}
            {devices.length === 0 && (
              <tr><td colSpan={6} style={{ padding: "14px 12px", fontSize: 12, color: c.hint }}>No kiosks registered yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
