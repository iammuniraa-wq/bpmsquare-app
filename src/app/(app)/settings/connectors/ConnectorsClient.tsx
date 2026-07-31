"use client";

import { useEffect, useState } from "react";
import { c, pillar } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { ConnectorDef, TenantConnectorRow } from "@/lib/connectors/types";

type State = { catalog: ConnectorDef[]; connected: TenantConnectorRow[] } | null;

export default function ConnectorsClient() {
  const [state, setState] = useState<State>(null);
  const [loading, setLoading] = useState(true);
  // Only one tile is ever expanded at a time -- lifted up here (not local to
  // each tile) so opening one collapses whichever other one was open.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The OAuth callback redirects back here with ?connector_error=... on
  // failure (expired link, provider rejected the request, server not
  // configured) -- there's no other channel to surface that, since the
  // whole point of a redirect-based flow is the browser navigates away and
  // back, not an in-page fetch this component could catch directly.
  const [oauthError, setOauthError] = useState<string | null>(null);

  function load() {
    fetch("/api/connectors")
      .then((r) => r.json())
      .then(setState)
      .finally(() => setLoading(false));
  }
  useEffect(load, []);
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("connector_error");
    if (err) {
      setOauthError(err);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (loading) return <div style={{ color: c.muted, fontSize: 13 }}>Loading…</div>;
  if (!state) return <div style={{ color: "var(--err-ink)", fontSize: 13 }}>Could not load connectors.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {oauthError && (
        <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", color: "var(--err-ink)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{oauthError}</span>
          <button onClick={() => setOauthError(null)} style={{ background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer", fontWeight: 700 }}>×</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
        {state.catalog.map((def) => {
          const row = state.connected.find((r) => r.connector_id === def.id) ?? null;
          const expanded = expandedId === def.id;
          return (
            <ConnectorTile
              key={def.id}
              def={def}
              row={row}
              expanded={expanded}
              onOpen={() => setExpandedId(def.id)}
              onClose={() => setExpandedId(null)}
              onChange={load}
            />
          );
        })}
      </div>
    </div>
  );
}

function ConnectorTile({
  def, row, expanded, onOpen, onClose, onChange,
}: {
  def: ConnectorDef; row: TenantConnectorRow | null; expanded: boolean;
  onOpen: () => void; onClose: () => void; onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const connected = !!row;

  // Collapsing (clicking a different tile, or Close) resets any in-progress
  // edit -- reopening a tile should never resurface a half-filled form or a
  // stale test result from last time.
  useEffect(() => {
    if (!expanded) { setEditing(false); setValues({}); setError(""); setTestMsg(null); }
  }, [expanded]);

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
      setTestMsg(res.ok ? { ok: true, text: json.message ?? "Test succeeded ✓" } : { ok: false, text: json.error ?? "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  const badge = (
    <span style={{
      fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "2px 7px",
      background: connected ? "var(--tealbg)" : c.panel2,
      color: connected ? "var(--tealink)" : c.hint,
    }}>
      {connected ? "Connected" : "Not connected"}
    </span>
  );

  const icon = (
    <span style={{
      width: 34, height: 34, borderRadius: 9, flexShrink: 0,
      background: pillar.blue.bg, color: pillar.blue.fg,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
    }}>
      {def.icon}
    </span>
  );

  if (!expanded) {
    return (
      <button
        onClick={onOpen}
        className="modern-lift"
        style={{
          ...cardStyle, padding: 16, textAlign: "left", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          border: `1px solid ${c.line}`, font: "inherit",
        }}
      >
        {icon}
        <span style={{ fontSize: 13, fontWeight: 700, color: c.ink, textAlign: "center" }}>{def.name}</span>
        {badge}
      </button>
    );
  }

  return (
    <div style={{ ...cardStyle, padding: 16, gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {icon}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{def.name}</span>
            {badge}
          </div>
          <div style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>{def.description}</div>
          {row?.connected_at && (
            <div style={{ fontSize: 11, color: c.hint, marginTop: 3 }}>
              Connected {new Date(row.connected_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {!connected && def.authType === "oauth2" && (
            // A real browser navigation, not fetch -- it has to end in an
            // actual redirect to the provider's own consent screen.
            <a href={`/api/connectors/${def.id}/oauth/start`} style={{ ...connectBtn(c.accent), textDecoration: "none", display: "inline-flex" }}>
              Connect
            </a>
          )}
          {!connected && def.authType === "api_key" && !editing && (
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
          <button onClick={onClose} title="Collapse" style={connectBtn(c.panel2, c.hint)}>×</button>
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
