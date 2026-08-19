"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import type { Account360SourceDef } from "@/lib/constants";

/**
 * Account 360 configuration. Two halves: which built-in cards the drawer
 * shows and in what order, and the tenant's own external source cards --
 * the "plug your ERP in" half, which is a URL, an optional auth header and
 * a handful of JSON paths, with no code involved.
 */

const BUILTINS: { id: string; label: string; description: string }[] = [
  { id: "pipeline", label: "Pipeline", description: "Open and won value, win rate, the loss pattern, recent quotations" },
  { id: "revenue", label: "Revenue", description: "Invoiced, collected, outstanding and what's past due" },
  { id: "service", label: "Service", description: "Open cases, average turnaround, open work orders" },
  { id: "people", label: "People", description: "Every contact attached to the account" },
  { id: "installed_base", label: "Installed base", description: "The assets this account owns" },
  { id: "coverage", label: "Coverage", description: "Contracts, their dates and value" },
];

type SourceDraft = Omit<Account360SourceDef, "auth_value"> & { auth_value?: string; has_secret?: boolean };

const label: React.CSSProperties = { display: "block", fontSize: 11.5, fontWeight: 600, color: c.muted, marginBottom: 4 };
const input: React.CSSProperties = {
  width: "100%", padding: "7px 10px", fontSize: 13, borderRadius: 8,
  border: `1px solid ${c.line}`, background: "var(--panel, #fff)", color: c.ink,
};

export default function Account360Client() {
  const [hidden, setHidden] = useState<string[]>([]);
  const [order, setOrder] = useState<string[]>(BUILTINS.map((b) => b.id));
  const [sources, setSources] = useState<SourceDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/settings/account-360")
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Could not load");
        setHidden(json.hidden_cards ?? []);
        const savedOrder: string[] = (json.card_order ?? []).filter((id: string) => BUILTINS.some((b) => b.id === id));
        setOrder([...savedOrder, ...BUILTINS.map((b) => b.id).filter((id) => !savedOrder.includes(id))]);
        // The route sends a masked placeholder, never the real credential.
        setSources((json.sources ?? []).map((s: Account360SourceDef) => ({
          ...s, has_secret: !!s.auth_value,
        })));
      })
      .catch((e) => setMessage({ tone: "error", text: (e as Error).message }))
      .finally(() => setLoading(false));
  }, []);

  function move(id: string, delta: number) {
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function patchSource(i: number, patch: Partial<SourceDraft>) {
    setSources((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/account-360", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hidden_cards: hidden,
          card_order: order,
          sources: sources.map(({ has_secret: _h, ...s }) => s),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      setMessage({ tone: "ok", text: "Saved" });
      setSources((prev) => prev.map((s) => (s.auth_value && s.auth_value !== "••••••••" ? { ...s, auth_value: "••••••••", has_secret: true } : s)));
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: c.muted }}>Loading…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 780 }}>
      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: c.ink }}>Cards</h2>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: c.muted, lineHeight: 1.55 }}>
          What the drawer shows, top to bottom. Switching a card off hides it for everyone in the workspace.
        </p>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {order.map((id, i) => {
            const b = BUILTINS.find((x) => x.id === id)!;
            const on = !hidden.includes(id);
            return (
              <div key={id} style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 0",
                borderTop: i === 0 ? "none" : `1px solid ${c.line}`,
              }}>
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => setHidden((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)))}
                  aria-label={b.label}
                  style={{ width: 15, height: 15, flexShrink: 0, accentColor: c.accent }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: on ? c.ink : c.hint }}>{b.label}</div>
                  <div style={{ fontSize: 11.5, color: c.hint, marginTop: 1 }}>{b.description}</div>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <ArrowButton dir="up" disabled={i === 0} onClick={() => move(id, -1)} />
                  <ArrowButton dir="down" disabled={i === order.length - 1} onClick={() => move(id, 1)} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700, color: c.ink }}>External sources</h2>
        <p style={{ margin: "0 0 14px", fontSize: 12.5, color: c.muted, lineHeight: 1.55 }}>
          Point a card at any system that answers with JSON over https — an ERP, a finance system, an
          enrichment service — and it renders alongside the built-in cards. The URL may carry{" "}
          <code style={{ fontSize: 11.5 }}>{"{account_id}"}</code>, <code style={{ fontSize: 11.5 }}>{"{account_ref}"}</code>,{" "}
          <code style={{ fontSize: 11.5 }}>{"{account_name}"}</code>, <code style={{ fontSize: 11.5 }}>{"{gstin}"}</code>,{" "}
          <code style={{ fontSize: 11.5 }}>{"{city}"}</code> or <code style={{ fontSize: 11.5 }}>{"{email}"}</code>, each
          filled in from the account being viewed. The request is made by BPMSquare&apos;s server, so private
          and internal addresses are refused.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {sources.map((s, i) => (
            <div key={i} style={{ border: `1px solid ${c.line}`, borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={(e) => patchSource(i, { enabled: e.target.checked })}
                  aria-label={`${s.title || "Source"} enabled`}
                  style={{ width: 15, height: 15, accentColor: c.accent }}
                />
                <input
                  value={s.title}
                  onChange={(e) => patchSource(i, { title: e.target.value })}
                  placeholder="Card title, e.g. SAP ERP"
                  style={{ ...input, flex: 1, fontWeight: 600 }}
                />
                <button
                  onClick={() => setSources((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 12, color: "#e5484d", font: "inherit" }}
                >
                  Remove
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={label}>Card id</label>
                  <input value={s.id} onChange={(e) => patchSource(i, { id: e.target.value })} placeholder="erp" style={input} />
                </div>
                <div>
                  <label style={label}>Root path (optional)</label>
                  <input value={s.root_path ?? ""} onChange={(e) => patchSource(i, { root_path: e.target.value })} placeholder="data.customer" style={input} />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={label}>URL</label>
                <input
                  value={s.url}
                  onChange={(e) => patchSource(i, { url: e.target.value })}
                  placeholder="https://erp.example.com/api/customers?gstin={gstin}"
                  style={input}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={label}>Auth header (optional)</label>
                  <input value={s.auth_header ?? ""} onChange={(e) => patchSource(i, { auth_header: e.target.value })} placeholder="Authorization" style={input} />
                </div>
                <div>
                  <label style={label}>Auth value {s.has_secret && <span style={{ color: c.hint, fontWeight: 400 }}>· saved</span>}</label>
                  <input
                    value={s.auth_value ?? ""}
                    onChange={(e) => patchSource(i, { auth_value: e.target.value })}
                    onFocus={(e) => { if (e.target.value === "••••••••") patchSource(i, { auth_value: "" }); }}
                    placeholder="Bearer …"
                    style={input}
                  />
                </div>
              </div>

              <label style={label}>Fields</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {(s.fields ?? []).map((f, fi) => (
                  <div key={fi} style={{ display: "flex", gap: 8 }}>
                    <input
                      value={f.label}
                      onChange={(e) => patchSource(i, { fields: s.fields.map((x, xi) => (xi === fi ? { ...x, label: e.target.value } : x)) })}
                      placeholder="Credit limit"
                      style={{ ...input, flex: 1 }}
                    />
                    <input
                      value={f.path}
                      onChange={(e) => patchSource(i, { fields: s.fields.map((x, xi) => (xi === fi ? { ...x, path: e.target.value } : x)) })}
                      placeholder="credit.limit"
                      style={{ ...input, flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}
                    />
                    <button
                      onClick={() => patchSource(i, { fields: s.fields.filter((_, xi) => xi !== fi) })}
                      aria-label="Remove field"
                      style={{ border: `1px solid ${c.line}`, background: "transparent", borderRadius: 8, cursor: "pointer", width: 30, color: c.muted }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => patchSource(i, { fields: [...(s.fields ?? []), { label: "", path: "" }] })}
                  style={{ alignSelf: "flex-start", border: "none", background: "transparent", cursor: "pointer", fontSize: 12, fontWeight: 600, color: c.accent, font: "inherit", padding: 0 }}
                >
                  + Add field
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={() => setSources((prev) => [...prev, { id: "", title: "", url: "", fields: [], enabled: true }])}
            style={{
              alignSelf: "flex-start", padding: "7px 12px", borderRadius: 8, cursor: "pointer", font: "inherit",
              fontSize: 12.5, fontWeight: 600, border: `1px solid ${c.line}`, background: "transparent", color: c.ink,
            }}
          >
            + Add a source
          </button>
        </div>
      </section>

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: "9px 18px", borderRadius: 8, border: "none", cursor: saving ? "default" : "pointer",
            background: c.accent, color: "#fff", fontSize: 13, fontWeight: 650, font: "inherit", opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {message && (
          <span style={{ fontSize: 12.5, color: message.tone === "ok" ? "#12a150" : "#e5484d" }}>{message.text}</span>
        )}
      </div>
    </div>
  );
}

function ArrowButton({ dir, disabled, onClick }: { dir: "up" | "down"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "up" ? "Move up" : "Move down"}
      style={{
        width: 26, height: 26, borderRadius: 7, cursor: disabled ? "default" : "pointer",
        border: `1px solid ${c.line}`, background: "transparent", opacity: disabled ? 0.35 : 1,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: dir === "down" ? "rotate(180deg)" : undefined }}>
        <path d="M8 12V4M4.5 7.5 8 4l3.5 3.5" fill="none" stroke={c.muted} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
