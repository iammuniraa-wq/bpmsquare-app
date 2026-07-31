"use client";

import { useEffect, useState } from "react";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { ConnectorDef, TenantConnectorRow } from "@/lib/connectors/types";

type State = { catalog: ConnectorDef[]; connected: TenantConnectorRow[] } | null;

export default function ConnectorsClient() {
  const [state, setState] = useState<State>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    fetch("/api/connectors")
      .then((r) => r.json())
      .then(setState)
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  if (loading) return <div style={{ color: c.muted, fontSize: 13 }}>Loading…</div>;
  if (!state) return <div style={{ color: "var(--err-ink)", fontSize: 13 }}>Could not load connectors.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {state.catalog.map((def) => {
        const row = state.connected.find((r) => r.connector_id === def.id) ?? null;
        return <ConnectorCard key={def.id} def={def} row={row} onChange={load} />;
      })}
    </div>
  );
}

function ConnectorCard({ def, row, onChange }: { def: ConnectorDef; row: TenantConnectorRow | null; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const connected = !!row;

  async function connect() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/connectors/${def.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to connect"); return; }
      setEditing(false);
      setValues({});
      onChange();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(`Disconnect ${def.name}? Anything relying on it will stop working.`)) return;
    await fetch(`/api/connectors/${def.id}`, { method: "DELETE" });
    onChange();
  }

  async function test() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch(`/api/connectors/${def.id}/test`, { method: "POST" });
      const json = await res.json();
      setTestMsg(res.ok ? { ok: true, text: "Test succeeded ✓" } : { ok: false, text: json.error ?? "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={{ ...cardStyle, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: pillar.blue.bg, color: pillar.blue.fg,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
        }}>
          {def.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{def.name}</span>
            <span style={{
              fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "2px 8px",
              background: connected ? "var(--tealbg)" : c.panel2,
              color: connected ? "var(--tealink)" : c.hint,
            }}>
              {connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>{def.description}</div>
          {row?.connected_at && (
            <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>
              Connected {new Date(row.connected_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {!connected && !editing && (
            <button onClick={() => setEditing(true)} style={connectBtn(c.accent)}>Connect</button>
          )}
          {connected && def.testable && (
            <button onClick={test} disabled={testing} style={connectBtn(c.panel2, c.ink)}>
              {testing ? "Testing…" : "Test"}
            </button>
          )}
          {connected && (
            <button onClick={disconnect} style={connectBtn(c.panel2, "var(--err-ink)")}>Disconnect</button>
          )}
        </div>
      </div>

      {testMsg && (
        <div style={{ marginTop: 10, fontSize: 12, color: testMsg.ok ? "var(--tealink)" : "var(--err-ink)" }}>
          {testMsg.text}
        </div>
      )}

      {editing && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${c.line}`, display: "flex", flexDirection: "column", gap: 10 }}>
          {def.fields.map((f) => (
            <div key={f.key}>
              <label style={{ fontSize: 11.5, color: c.muted, display: "block", marginBottom: 4 }}>{f.label}</label>
              <input
                type={f.secret ? "password" : "text"}
                value={values[f.key] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, background: c.panel, outline: "none" }}
              />
            </div>
          ))}
          {error && <div style={{ fontSize: 12, color: "var(--err-ink)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={connect} disabled={saving} style={connectBtn(c.accent)}>{saving ? "Connecting…" : "Save & connect"}</button>
            <button onClick={() => { setEditing(false); setValues({}); setError(""); }} style={connectBtn(c.panel2, c.muted)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function connectBtn(bg: string, color = "#fff"): React.CSSProperties {
  return { padding: "7px 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, background: bg, color, border: "none", cursor: "pointer", whiteSpace: "nowrap" };
}
