"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { c, statusInk } from "@/lib/theme";

type Suggestion = { name: string; email: string; preferred: boolean };

const field: React.CSSProperties = {
  width: "100%", fontSize: 12.5, padding: "7px 9px", border: `1px solid ${c.line}`,
  borderRadius: 6, background: c.panel, color: c.ink, boxSizing: "border-box",
};

/**
 * Send the invoice PDF by email: the account's contacts to tick, plus any
 * address typed in by hand (owner decision 2026-09-06 -- both, on the send
 * step). Subject and body come from the tenant's invoice template and can
 * be edited before sending.
 */
export default function EmailInvoicePanel({ invoiceId, invoiceRef, onClose }: { invoiceId: string; invoiceRef: string; onClose: () => void }) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string[] | null>(null);

  useEffect(() => {
    fetch(`/api/invoices/${invoiceId}/email`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) { setError(j.error ?? "Could not load"); return; }
        setSuggestions(j.suggestions ?? []);
        setPicked(new Set((j.suggestions ?? []).filter((s: Suggestion) => s.preferred).map((s: Suggestion) => s.email)));
        setSubject(j.subject ?? "");
        setBody(j.body ?? "");
        setConfigured(j.configured !== false);
      })
      .catch(() => setError("Network error"))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  function addTyped() {
    const e = typed.trim().toLowerCase();
    if (!e) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setError("That doesn't look like an email address."); return; }
    setError("");
    if (!manual.includes(e) && !picked.has(e)) setManual([...manual, e]);
    setTyped("");
  }

  const recipients = [...picked, ...manual];

  async function send() {
    setSending(true); setError("");
    const r = await fetch(`/api/invoices/${invoiceId}/email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: recipients, subject, body }),
    }).catch(() => null);
    setSending(false);
    if (!r) { setError("Network error"); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Failed to send"); return; }
    setDone(j.sentTo ?? recipients);
    router.refresh();
  }

  return (
    <div style={{ border: `1px solid ${c.line}`, borderRadius: 8, padding: 12, background: c.panel2, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Email {invoiceRef}</div>
        <button type="button" onClick={onClose} style={{ border: "none", background: "none", color: c.hint, cursor: "pointer", fontSize: 14 }}>✕</button>
      </div>

      {done ? (
        <div style={{ fontSize: 12.5, color: statusInk.good, lineHeight: 1.5 }}>
          Sent to {done.join(", ")}.
        </div>
      ) : loading ? (
        <div style={{ fontSize: 12, color: c.hint }}>Loading…</div>
      ) : (
        <>
          {!configured && (
            <div style={{ fontSize: 12, color: statusInk.warn, lineHeight: 1.45 }}>Email sending isn't configured for this workspace yet.</div>
          )}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>To</div>
            {suggestions.length === 0 && manual.length === 0 && (
              <div style={{ fontSize: 12, color: c.hint, marginBottom: 6 }}>No email on the account or its contacts — type one below.</div>
            )}
            {suggestions.map((s) => (
              <label key={s.email} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: c.ink, padding: "3px 0", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={picked.has(s.email)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(s.email); else next.delete(s.email);
                    setPicked(next);
                  }}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name} <span style={{ color: c.hint }}>· {s.email}</span>
                </span>
              </label>
            ))}
            {manual.map((m) => (
              <div key={m} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5, color: c.ink, padding: "3px 0" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{m}</span>
                <button type="button" onClick={() => setManual(manual.filter((x) => x !== m))} style={{ border: "none", background: "none", color: c.hint, cursor: "pointer" }}>✕</button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                style={field}
                placeholder="Add an email address"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTyped(); } }}
              />
              <button type="button" onClick={addTyped} style={{ fontSize: 12, fontWeight: 600, padding: "0 10px", borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, color: c.ink, cursor: "pointer" }}>Add</button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Subject</div>
            <input style={field} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Message</div>
            <textarea style={{ ...field, minHeight: 110, resize: "vertical", fontFamily: "inherit" }} value={body} onChange={(e) => setBody(e.target.value)} />
            <div style={{ fontSize: 11, color: c.hint, marginTop: 4 }}>The PDF is attached automatically.</div>
          </div>

          {error && <div style={{ fontSize: 12, color: statusInk.bad }}>{error}</div>}

          <button
            type="button"
            disabled={sending || recipients.length === 0 || !configured}
            onClick={send}
            style={{
              background: c.accent, color: "#fff", borderRadius: 7, padding: "8px 14px", fontSize: 12.5, fontWeight: 600,
              border: "none", cursor: sending || recipients.length === 0 ? "default" : "pointer",
              opacity: sending || recipients.length === 0 || !configured ? 0.55 : 1,
            }}
          >
            {sending ? "Sending…" : `Send to ${recipients.length || "…"}`}
          </button>
        </>
      )}
    </div>
  );
}
