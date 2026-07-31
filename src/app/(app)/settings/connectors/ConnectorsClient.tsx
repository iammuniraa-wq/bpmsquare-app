"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { CONNECTOR_ICONS } from "@/components/connectorIcons";
import type { ConnectorDef, TenantConnectorRow } from "@/lib/connectors/types";

type State = { catalog: ConnectorDef[]; connected: TenantConnectorRow[] } | null;

export default function ConnectorsClient() {
  const [state, setState] = useState<State>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const selected = state.catalog.find((d) => d.id === selectedId) ?? null;
  const selectedRow = selected ? state.connected.find((r) => r.connector_id === selected.id) ?? null : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {oauthError && (
        <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", color: "var(--err-ink)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{oauthError}</span>
          <button onClick={() => setOauthError(null)} style={{ background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer", fontWeight: 700 }}>×</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
        {state.catalog.map((def) => {
          const row = state.connected.find((r) => r.connector_id === def.id) ?? null;
          return <ConnectorTile key={def.id} def={def} row={row} onOpen={() => setSelectedId(def.id)} />;
        })}
      </div>

      {selected && (
        <ConnectorModal
          def={selected}
          row={selectedRow}
          onClose={() => setSelectedId(null)}
          onChange={load}
        />
      )}
    </div>
  );
}

function connectorIcon(def: ConnectorDef, size: number) {
  const iconDef = CONNECTOR_ICONS[def.id];
  return (
    <span style={{
      width: size, height: size, borderRadius: size * 0.26, flexShrink: 0,
      background: iconDef?.bg ?? c.panel2, color: iconDef?.fg ?? c.ink,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.4,
    }}>
      {iconDef ? iconDef.Glyph({ size: Math.round(size * 0.42) }) : def.icon}
    </span>
  );
}

function statusBadge(connected: boolean) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, borderRadius: 6, padding: "2px 7px",
      background: connected ? "var(--tealbg)" : c.panel2,
      color: connected ? "var(--tealink)" : c.hint,
    }}>
      {connected ? "Connected" : "Not connected"}
    </span>
  );
}

/** A launcher, not a container -- clicking always opens the modal below. No
 * content ever grows inside the tile itself, so the grid never reflows and
 * every tile stays visually stable regardless of what's open. */
function ConnectorTile({ def, row, onOpen }: { def: ConnectorDef; row: TenantConnectorRow | null; onOpen: () => void }) {
  const connected = !!row;
  return (
    <button
      onClick={onOpen}
      className="modern-lift connector-tile"
      style={{
        ...cardStyle, padding: 18, textAlign: "left", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 12,
        border: `1px solid ${c.line}`, font: "inherit",
      }}
    >
      {connectorIcon(def, 40)}
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{def.name}</span>
        {statusBadge(connected)}
      </span>
    </button>
  );
}

function ConnectorModal({
  def, row, onClose, onChange,
}: {
  def: ConnectorDef; row: TenantConnectorRow | null; onClose: () => void; onChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const connected = !!row;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      onChange();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!window.confirm(`Disconnect ${def.name}? Anything relying on it will stop working.`)) return;
    await fetch(`/api/connectors/${def.id}`, { method: "DELETE" });
    onChange();
    onClose();
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

  return (
    <div
      onClick={onClose}
      className="connector-backdrop"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="connector-modal"
        style={{ background: c.panel, borderRadius: 16, width: 440, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 24px 70px rgba(0,0,0,.4)" }}
      >
        <div style={{ padding: "24px 24px 20px", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            {connectorIcon(def, 48)}
            <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", fontSize: 18, color: c.hint, cursor: "pointer", lineHeight: 1, padding: 4 }}>✕</button>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: c.ink }}>{def.name}</span>
              {statusBadge(connected)}
            </div>
            <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.55 }}>{def.description}</div>
            {row?.connected_at && (
              <div style={{ fontSize: 11, color: c.hint, marginTop: 6 }}>
                Connected {new Date(row.connected_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
              </div>
            )}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${c.line}`, padding: "20px 24px 24px" }}>
          {testMsg && (
            <div style={{ marginBottom: 14, fontSize: 12.5, padding: "9px 12px", borderRadius: 8, background: testMsg.ok ? "var(--tealbg)" : "var(--err-bg)", color: testMsg.ok ? "var(--tealink)" : "var(--err-ink)" }}>
              {testMsg.text}
            </div>
          )}

          {!connected && def.authType === "oauth2" && (
            <a href={`/api/connectors/${def.id}/oauth/start`} style={{ ...actionBtn(c.accent), textDecoration: "none", display: "inline-flex", width: "100%", justifyContent: "center", boxSizing: "border-box" }}>
              Connect
            </a>
          )}

          {!connected && def.authType === "api_key" && !editing && (
            <button onClick={() => setEditing(true)} style={{ ...actionBtn(c.accent), width: "100%" }}>Connect</button>
          )}

          {!connected && def.authType === "api_key" && editing && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {def.fields.map((f) => (
                <div key={f.key}>
                  <label style={{ fontSize: 11.5, color: c.muted, display: "block", marginBottom: 5 }}>{f.label}</label>
                  <input
                    type={f.secret ? "password" : "text"}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, background: c.panel, outline: "none" }}
                  />
                </div>
              ))}
              {error && <div style={{ fontSize: 12, color: "var(--err-ink)" }}>{error}</div>}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={connect} disabled={saving} style={{ ...actionBtn(c.accent), flex: 1 }}>{saving ? "Connecting…" : "Save & connect"}</button>
                <button onClick={() => { setEditing(false); setValues({}); setError(""); }} style={actionBtn(c.panel2, c.muted)}>Cancel</button>
              </div>
            </div>
          )}

          {connected && (
            <div style={{ display: "flex", gap: 8 }}>
              {def.testable && (
                <button onClick={test} disabled={testing} style={{ ...actionBtn(c.panel2, c.ink), flex: 1 }}>
                  {testing ? "Testing…" : "Test connection"}
                </button>
              )}
              <button onClick={disconnect} style={actionBtn(c.panel2, "var(--err-ink)")}>Disconnect</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function actionBtn(bg: string, color = "#fff"): React.CSSProperties {
  return { padding: "10px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: bg, color, border: "none", cursor: "pointer", whiteSpace: "nowrap" };
}
