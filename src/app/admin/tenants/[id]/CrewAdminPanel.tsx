"use client";

import { useEffect, useState } from "react";

// Platform-admin section of the tenant editor (docs/design/nova-crew-agents.md open questions 2 and 3): each agent's monthly token allowance and
// who may see its findings during the shadow period. A workspace admin cannot set either. Saved on its own (PUT /api/admin/crew/[tenantId]).

type Row = { key: string; name: string; enabled: boolean; cap: number | null; defaultCap: number; visibility: "admins" | "deal_teams"; used: number };

const box: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 16 };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 8, fontSize: 13 };

export default function CrewAdminPanel({ tenantId }: { tenantId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/crew/${tenantId}`).then((r) => r.json()).then((j) => { if (live) { setPending(j.pending === true); setRows(j.agents ?? []); } }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [tenantId]);

  async function save() {
    setMsg("");
    const res = await fetch(`/api/admin/crew/${tenantId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents: (rows ?? []).map((r) => ({ key: r.key, cap: r.cap, visibility: r.visibility })) }),
    });
    const j = await res.json().catch(() => ({}));
    setMsg(res.ok ? "Saved." : j.error ?? "Save failed");
  }

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <section style={box}>
      <h2 style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 600, color: "#374151" }}>AI automation (agents)</h2>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "#6b7280" }}>
        Each agent has its own monthly token allowance on top of the workspace&apos;s pooled AI allowance; the tightest wins. Leave the box empty for the default.
        Shadow period: only workspace admins see findings until you widen an agent to deal teams.
      </p>
      {pending && <p style={{ fontSize: 12, color: "#b45309" }}>Needs a database update (migration 0245) before anything here can be saved.</p>}
      {rows === null ? <p style={{ fontSize: 12, color: "#6b7280" }}>Loading...</p> : (
        <div style={{ display: "grid", gap: 14 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, alignItems: "end" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>{r.name}<div style={{ fontWeight: 400, fontSize: 11, color: "#6b7280" }}>Used this month: {r.used.toLocaleString("en-GB")} · {r.enabled ? "On" : "Off"}</div></div>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Monthly token cap</label>
                <input style={input} inputMode="numeric" value={r.cap ?? ""} placeholder={String(r.defaultCap)} onChange={(e) => set(r.key, { cap: e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9]/g, "")) })} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>Who sees findings</label>
                <select style={input} value={r.visibility} onChange={(e) => set(r.key, { visibility: e.target.value as Row["visibility"] })}>
                  <option value="admins">Workspace admins only (shadow)</option>
                  <option value="deal_teams">Admins and the people a finding is addressed to</option>
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ marginTop: 14, display: "flex", gap: 12, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={pending || rows === null} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#111827", color: "#fff", fontSize: 13, cursor: "pointer" }}>Save AI automation</button>
        {msg && <span style={{ fontSize: 12, color: msg === "Saved." ? "#047857" : "#b91c1c" }}>{msg}</span>}
      </div>
    </section>
  );
}
