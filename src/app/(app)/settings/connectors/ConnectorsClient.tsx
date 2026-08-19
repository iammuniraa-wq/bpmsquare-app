"use client";

import { useEffect, useState } from "react";
import { useFeel } from "@/components/FeelProvider";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { CONNECTOR_ICONS } from "@/components/connectorIcons";
import type { ConnectorDef, TenantConnectorRow } from "@/lib/connectors/types";

type State = { catalog: ConnectorDef[]; connected: TenantConnectorRow[] } | null;

const SPRING = { type: "spring" as const, stiffness: 420, damping: 38, mass: 0.9 };

export default function ConnectorsClient() {
  const [state, setState] = useState<State>(null);
  const [loading, setLoading] = useState(true);
  // Only one tile is ever expanded -- lifted up here (not local to each
  // tile) so opening one collapses whichever other one was open.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The OAuth callback redirects back here with ?connector_error=... on
  // failure -- there's no other channel to surface that, since the whole
  // point of a redirect-based flow is the browser navigates away and back,
  // not an in-page fetch this component could catch directly.
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
    <MotionConfig reducedMotion="user">
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {oauthError && (
        <div style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", color: "var(--err-ink)", borderRadius: 8, padding: "10px 14px", fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{oauthError}</span>
          <button onClick={() => setOauthError(null)} style={{ background: "none", border: "none", color: "var(--err-ink)", cursor: "pointer", fontWeight: 700 }}>×</button>
        </div>
      )}
      {/* Every tile shares this grid, and every tile carries `layout` --
          Framer Motion measures each one's box before and after ANY render
          (not just the one that was clicked) and animates the difference
          with a FLIP transform. That's what makes the other tiles glide to
          their new slot instead of snapping there the instant one expands. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
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
    </MotionConfig>
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

  // Collapsing resets any in-progress edit -- reopening a tile should never
  // resurface a half-filled form or a stale test result from last time.
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

  const { confirm } = useFeel();
  async function disconnect() {
    if (!(await confirm({ title: `Disconnect ${def.name}?`, body: "Anything relying on it stops working straight away.", confirmLabel: "Disconnect", tone: "danger" }))) return;
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

  return (
    // The single element Framer Motion tracks across the compact <-> expanded
    // render -- `layout` makes it FLIP-animate its own box (position, width,
    // height, border-radius all included) whenever those change between
    // renders, which is what makes it read as "this tile grew," not "this
    // tile vanished and a different one took its place."
    <motion.div
      layout
      transition={SPRING}
      onClick={!expanded ? onOpen : undefined}
      className={!expanded ? "modern-lift connector-tile" : undefined}
      style={{
        ...cardStyle, padding: 18, cursor: expanded ? "default" : "pointer",
        gridColumn: expanded ? "1 / -1" : undefined,
        border: `1px solid ${c.line}`,
        position: "relative", zIndex: expanded ? 1 : 0, overflow: "hidden",
      }}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        {!expanded ? (
          <motion.div
            key="compact"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            style={{ display: "flex", alignItems: "center", gap: 12 }}
          >
            {connectorIcon(def, 40)}
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: c.ink }}>{def.name}</span>
              {statusBadge(connected)}
            </span>
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.15, delay: 0.05 }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              {connectorIcon(def, 44)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: c.ink }}>{def.name}</span>
                  {statusBadge(connected)}
                </div>
                <div style={{ fontSize: 12.5, color: c.muted, marginTop: 4, lineHeight: 1.55 }}>{def.description}</div>
                {row?.connected_at && (
                  <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>
                    Connected {new Date(row.connected_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                  </div>
                )}
              </div>
              <button onClick={onClose} title="Collapse" aria-label="Collapse" style={{ background: "none", border: "none", fontSize: 16, color: c.hint, cursor: "pointer", lineHeight: 1, padding: 4, flexShrink: 0 }}>✕</button>
            </div>

            <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
              {testMsg && (
                <div style={{ marginBottom: 12, fontSize: 12.5, padding: "9px 12px", borderRadius: 8, background: testMsg.ok ? "var(--tealbg)" : "var(--err-bg)", color: testMsg.ok ? "var(--tealink)" : "var(--err-ink)" }}>
                  {testMsg.text}
                </div>
              )}

              {!connected && def.authType === "oauth2" && (
                <a href={`/api/connectors/${def.id}/oauth/start`} style={{ ...actionBtn(c.accent), textDecoration: "none", display: "inline-flex" }}>
                  Connect
                </a>
              )}

              {!connected && def.authType === "api_key" && !editing && (
                <button onClick={() => setEditing(true)} style={actionBtn(c.accent)}>Connect</button>
              )}

              {!connected && def.authType === "api_key" && editing && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
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
                    <button onClick={connect} disabled={saving} style={actionBtn(c.accent)}>{saving ? "Connecting…" : "Save & connect"}</button>
                    <button onClick={() => { setEditing(false); setValues({}); setError(""); }} style={actionBtn(c.panel2, c.muted)}>Cancel</button>
                  </div>
                </div>
              )}

              {connected && (
                <div style={{ display: "flex", gap: 8 }}>
                  {def.testable && (
                    <button onClick={test} disabled={testing} style={actionBtn(c.panel2, c.ink)}>
                      {testing ? "Testing…" : "Test connection"}
                    </button>
                  )}
                  <button onClick={disconnect} style={actionBtn(c.panel2, "var(--err-ink)")}>Disconnect</button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function actionBtn(bg: string, color = "#fff"): React.CSSProperties {
  return { padding: "9px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: bg, color, border: "none", cursor: "pointer", whiteSpace: "nowrap" };
}
