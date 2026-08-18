"use client";

import { useCallback, useEffect, useState } from "react";
import { c } from "@/lib/theme";

// Scoped API keys manager (Settings -> Developer). Admin-only surface; the
// route it talks to enforces that server-side. A freshly created token is
// shown exactly once -- there is no path to retrieve it afterwards.

const SCOPABLE_OBJECTS = [
  { key: "quotations", label: "Quotations" },
  { key: "accounts", label: "Accounts" },
  { key: "cases", label: "Cases" },
  { key: "inventory", label: "Inventory" },
  { key: "invoices", label: "Invoices" },
  { key: "purchase-orders", label: "Purchase Orders" },
  { key: "pricing", label: "Pricing (engine)" },
  // Staff personal data: a key reaches it ONLY by naming it here, never via
  // the all-objects wildcard (see EXPLICIT_SCOPE_ONLY in api/v1/_auth.ts).
  { key: "employees", label: "Employees (staff data)" },
];

type Scopes = { read: boolean; write: boolean; objects: string[] };
type KeyRow = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: Scopes;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function scopeSummary(s: Scopes): string {
  const access = s.write ? (s.read ? "Read + write" : "Write only") : "Read only";
  const objects = !s.objects || s.objects.includes("*") ? "all objects" : s.objects.join(", ");
  return `${access} · ${objects}`;
}

function fmt(d: string | null): string {
  if (!d) return "—";
  const t = new Date(d);
  return isNaN(t.getTime()) ? "—" : t.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const box: React.CSSProperties = { padding: "10px 12px", background: c.panel2, borderRadius: 8, border: `1px solid ${c.line}` };
const btn: React.CSSProperties = { padding: "6px 14px", borderRadius: 7, fontSize: 12, fontWeight: 500, border: `1px solid ${c.line}`, background: "var(--panel)", cursor: "pointer", color: c.muted };

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [allObjects, setAllObjects] = useState(true);
  const [objects, setObjects] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/api-keys");
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load keys"); setKeys([]); }
      else { setKeys(json.keys ?? []); setError(null); }
    } catch {
      setError("Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleObject = (key: string) =>
    setObjects((prev) => (prev.includes(key) ? prev.filter((o) => o !== key) : [...prev, key]));

  async function create() {
    setError(null);
    if (!name.trim()) { setError("Give the key a name."); return; }
    if (!allObjects && objects.length === 0) { setError("Pick at least one object, or choose all objects."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes: { read: canRead, write: canWrite, objects: allObjects ? ["*"] : objects },
          expires_at: expiresAt || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to create key"); return; }
      setNewToken(json.token);
      setName(""); setCanWrite(false); setCanRead(true); setAllObjects(true); setObjects([]); setExpiresAt("");
      setCreating(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/settings/api-keys/${id}`, { method: "DELETE" });
    if (res.ok) await load();
    else { const j = await res.json().catch(() => ({})); setError(j.error ?? "Failed to revoke"); }
  }

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Scoped API keys</div>
        {!creating && (
          <button onClick={() => { setCreating(true); setNewToken(null); }} style={btn}>+ New key</button>
        )}
      </div>
      <div style={{ fontSize: 11.5, color: c.hint, marginBottom: 10 }}>
        Fine-grained alternative to the full-access key above: restrict a key to read-only, or to specific objects, and revoke it independently. The token is shown once at creation.
      </div>

      {error && <div style={{ fontSize: 11.5, color: "var(--err-ink)", marginBottom: 8 }}>{error}</div>}

      {/* One-time token reveal */}
      {newToken && (
        <div style={{ ...box, marginBottom: 12, borderColor: "var(--teal)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--teal)", marginBottom: 4 }}>Key created — copy it now. It will not be shown again.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <code style={{ fontSize: 12.5, color: c.ink, fontFamily: "monospace", wordBreak: "break-all", flex: 1 }}>{newToken}</code>
            <button
              onClick={() => { navigator.clipboard?.writeText(newToken); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              style={{ ...btn, color: copied ? "var(--teal)" : c.muted, flexShrink: 0 }}
            >{copied ? "✓ Copied" : "Copy"}</button>
          </div>
        </div>
      )}

      {/* Create form */}
      {creating && (
        <div style={{ ...box, marginBottom: 12 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, marginBottom: 4 }}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Partner read-only sync"
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, outline: "none", marginBottom: 12, background: "var(--panel)" }} />

          <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.ink, cursor: "pointer" }}>
              <input type="checkbox" checked={canRead} onChange={(e) => setCanRead(e.target.checked)} /> Read
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.ink, cursor: "pointer" }}>
              <input type="checkbox" checked={canWrite} onChange={(e) => setCanWrite(e.target.checked)} /> Write
            </label>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: c.ink, cursor: "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={allObjects} onChange={(e) => setAllObjects(e.target.checked)} /> All objects
          </label>
          {!allObjects && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
              {SCOPABLE_OBJECTS.map((o) => (
                <label key={o.key} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: c.ink, cursor: "pointer", padding: "4px 8px", border: `1px solid ${c.line}`, borderRadius: 6, background: objects.includes(o.key) ? "var(--bluebg)" : "transparent" }}>
                  <input type="checkbox" checked={objects.includes(o.key)} onChange={() => toggleObject(o.key)} /> {o.label}
                </label>
              ))}
            </div>
          )}

          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: c.muted, marginBottom: 4 }}>Expires (optional)</label>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)}
            style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${c.line}`, fontSize: 13, color: c.ink, outline: "none", marginBottom: 14, background: "var(--panel)" }} />

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={create} disabled={busy} style={{ ...btn, background: "var(--accent, #378add)", color: "#fff", borderColor: "transparent", cursor: busy ? "not-allowed" : "pointer" }}>{busy ? "Creating…" : "Create key"}</button>
            <button onClick={() => { setCreating(false); setError(null); }} style={btn}>Cancel</button>
          </div>
        </div>
      )}

      {/* Existing keys */}
      {loading ? (
        <div style={{ fontSize: 12, color: c.hint }}>Loading…</div>
      ) : keys.length === 0 ? (
        <div style={{ fontSize: 12, color: c.hint, fontStyle: "italic" }}>No scoped keys yet.</div>
      ) : (
        <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden" }}>
          {keys.map((k, i) => {
            const revoked = !!k.revoked_at;
            const expired = k.expires_at ? new Date(k.expires_at).getTime() <= Date.now() : false;
            return (
              <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i === 0 ? "none" : `1px solid ${c.line}`, opacity: revoked ? 0.55 : 1 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: c.ink, fontWeight: 500 }}>
                    {k.name}
                    {revoked && <span style={{ fontSize: 10.5, color: "var(--err-ink)", marginLeft: 8 }}>revoked</span>}
                    {!revoked && expired && <span style={{ fontSize: 10.5, color: "var(--err-ink)", marginLeft: 8 }}>expired</span>}
                  </div>
                  <div style={{ fontSize: 11, color: c.muted, marginTop: 1 }}>
                    <code style={{ fontFamily: "monospace" }}>{k.token_prefix}…</code> · {scopeSummary(k.scopes)}
                  </div>
                  <div style={{ fontSize: 10.5, color: c.hint, marginTop: 1 }}>
                    Last used {fmt(k.last_used_at)} · {k.expires_at ? `expires ${fmt(k.expires_at)}` : "no expiry"}
                  </div>
                </div>
                {!revoked && (
                  <button onClick={() => revoke(k.id)} style={{ ...btn, color: "var(--err-ink)", flexShrink: 0 }}>Revoke</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
