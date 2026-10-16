"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";

// Outbound webhooks manager (Settings -> Developer). Admin-only surface, admin
// enforced server-side. Each webhook gets an HMAC signing secret (shown to
// admins so they can verify signatures on their receiver) and can be tested,
// paused, and deleted.

const SUBSCRIBABLE_OBJECTS = [
  { key: "quotes", label: "Quotes" }, { key: "accounts", label: "Accounts" },
  { key: "contacts", label: "Contacts" }, { key: "cases", label: "Cases" },
  { key: "work_orders", label: "Work Orders" }, { key: "invoices", label: "Invoices" },
  { key: "purchase_orders", label: "Purchase Orders" }, { key: "inventory", label: "Inventory" },
  { key: "assets", label: "Assets" }, { key: "suppliers", label: "Suppliers" },
];

type Webhook = {
  id: string; name: string; url: string; secret: string;
  object_types: string[]; active: boolean;
  last_delivery_at: string | null; last_status: number | null; last_error: string | null;
  failure_count: number; created_at: string;
};

const box: React.CSSProperties = { padding: "10px 12px", background: c.panel2, borderRadius: 8, border: `1px solid ${c.line}` };
const btn: React.CSSProperties = { padding: "6px 12px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: "pointer", color: c.muted };

function fmt(d: string | null): string {
  if (!d) return "never";
  const t = new Date(d);
  return isNaN(t.getTime()) ? "never" : t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function WebhooksPanel() {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [allObjects, setAllObjects] = useState(true);
  const [objects, setObjects] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/webhooks");
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load"); setHooks([]); }
      else { setHooks(json.webhooks ?? []); setError(null); }
    } catch { setError("Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleObject = (key: string) =>
    setObjects((prev) => (prev.includes(key) ? prev.filter((o) => o !== key) : [...prev, key]));

  async function create() {
    setError(null);
    if (!name.trim()) { setError("Give the webhook a name."); return; }
    if (!/^https:\/\/.+/i.test(url.trim())) { setError("Enter an https:// URL."); return; }
    if (!allObjects && objects.length === 0) { setError("Pick at least one object, or subscribe to all."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/webhooks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), url: url.trim(), object_types: allObjects ? ["*"] : objects }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create"); return; }
      setName(""); setUrl(""); setAllObjects(true); setObjects([]); setCreating(false);
      await load();
    } finally { setBusy(false); }
  }

  async function toggleActive(h: Webhook) {
    await fetch(`/api/settings/webhooks/${h.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !h.active }),
    });
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/settings/webhooks/${id}`, { method: "DELETE" });
    await load();
  }

  async function test(id: string) {
    setTestResult((p) => ({ ...p, [id]: "…" }));
    const res = await fetch(`/api/settings/webhooks/${id}/test`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    setTestResult((p) => ({ ...p, [id]: res.ok ? `✓ ${json.status}` : `✕ ${json.error ?? json.status ?? "failed"}` }));
    await load();
  }

  return (
    <div style={{ marginBottom: 6, marginTop: 18, paddingTop: 16, borderTop: `1px solid ${c.line}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Webhooks</div>
        {!creating && <button onClick={() => setCreating(true)} style={btn}>+ New webhook</button>}
      </div>
      <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 10 }}>
        Push every create/update/delete to your endpoint as it happens, signed with HMAC-SHA256 (header <code style={{ fontFamily: "monospace" }}>X-BPMSquare-Signature</code>). Only events after registration are delivered.
      </div>

      {error && <div style={{ fontSize: 11.5, color: "var(--err-ink)", marginBottom: 8 }}>{error}</div>}

      {creating && (
        <div style={{ ...box, marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, marginBottom: 4 }}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ERP sync"
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, outline: "none", marginBottom: 10, background: "var(--panel)" }} />
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, marginBottom: 4 }}>Endpoint URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-system.example.com/hooks/bpmsquare"
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, outline: "none", marginBottom: 12, background: "var(--panel)" }} />

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.ink, cursor: "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={allObjects} onChange={(e) => setAllObjects(e.target.checked)} /> All objects
          </label>
          {!allObjects && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {SUBSCRIBABLE_OBJECTS.map((o) => (
                <label key={o.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: c.ink, cursor: "pointer", padding: "4px 8px", border: `1px solid ${c.line}`, borderRadius: 6, background: objects.includes(o.key) ? "var(--bluebg)" : "transparent" }}>
                  <input type="checkbox" checked={objects.includes(o.key)} onChange={() => toggleObject(o.key)} /> {o.label}
                </label>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={create} disabled={busy} style={{ ...btn, background: "var(--accent, #378add)", color: "#fff", borderColor: "transparent", cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Creating…" : "Create webhook"}</button>
            <button onClick={() => { setCreating(false); setError(null); }} style={btn}>Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ fontSize: 12, color: c.hint }}>Loading…</div>
      ) : hooks.length === 0 ? (
        <div style={{ fontSize: 12, color: c.hint, fontStyle: "italic" }}>No webhooks yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {hooks.map((h) => (
            <div key={h.id} style={{ ...box, opacity: h.active ? 1 : 0.6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: c.ink, fontWeight: 500 }}>
                    {h.name}
                    {!h.active && <span style={{ fontSize: 10.5, color: "var(--err-ink)", marginLeft: 8 }}>paused</span>}
                  </div>
                  <div style={{ fontSize: 11, color: c.muted, marginTop: 1, wordBreak: "break-all" }}>{h.url}</div>
                  <div style={{ fontSize: 10.5, color: c.hint, marginTop: 1 }}>
                    {(!h.object_types || h.object_types.includes("*")) ? "all objects" : h.object_types.join(", ")} · last {fmt(h.last_delivery_at)}
                    {h.last_status != null && ` (${h.last_status})`}
                    {h.failure_count > 0 && ` · ${h.failure_count} failure${h.failure_count === 1 ? "" : "s"}`}
                    {testResult[h.id] && ` · test ${testResult[h.id]}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => test(h.id)} style={btn}>Test</button>
                  <button onClick={() => toggleActive(h)} style={btn}>{h.active ? "Pause" : "Resume"}</button>
                  <button onClick={() => remove(h.id)} style={{ ...btn, color: "var(--err-ink)" }}>Delete</button>
                </div>
              </div>
              <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10.5, color: c.muted }}>Signing secret</span>
                <code style={{ fontSize: 11.5, color: c.ink, fontFamily: "monospace", flex: 1, wordBreak: "break-all" }}>
                  {revealed[h.id] ? h.secret : "whsec_••••••••••••"}
                </code>
                <button onClick={() => setRevealed((p) => ({ ...p, [h.id]: !p[h.id] }))} style={btn}>{revealed[h.id] ? "Hide" : "Reveal"}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
