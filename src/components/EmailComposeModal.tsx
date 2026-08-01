"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import type { EmailTemplate } from "@/lib/types";
import { renderTemplate, DEFAULT_EMAIL_TEMPLATES } from "@/lib/emailTemplates";

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "8px 10px", borderRadius: 7,
  border: `1px solid ${c.line}`, fontSize: 13,
  background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};
const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: c.hint,
  textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block",
};

export default function EmailComposeModal({
  quoteId, defaultRecipient, vars, onClose, onSent,
}: {
  quoteId: string;
  defaultRecipient: string | null;
  /** Values to substitute into {{tokens}} for this specific quote. */
  vars: Record<string, string>;
  onClose: () => void;
  onSent: (recipient: string) => void;
}) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("__default__");
  const [recipient, setRecipient] = useState(defaultRecipient ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/email-templates?category=quote")
      .then((r) => r.json())
      .then((data: EmailTemplate[]) => {
        setTemplates(Array.isArray(data) ? data : []);
        const def = Array.isArray(data) ? data.find((t) => t.is_default) : undefined;
        if (def) {
          setTemplateId(def.id);
          setSubject(renderTemplate(def.subject, vars));
          setBody(renderTemplate(def.body, vars));
        } else {
          setSubject(renderTemplate(DEFAULT_EMAIL_TEMPLATES.quote.subject, vars));
          setBody(renderTemplate(DEFAULT_EMAIL_TEMPLATES.quote.body, vars));
        }
        setLoading(false);
      })
      .catch(() => {
        setSubject(renderTemplate(DEFAULT_EMAIL_TEMPLATES.quote.subject, vars));
        setBody(renderTemplate(DEFAULT_EMAIL_TEMPLATES.quote.body, vars));
        setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTemplate(id: string) {
    setTemplateId(id);
    if (id === "__default__") {
      setSubject(renderTemplate(DEFAULT_EMAIL_TEMPLATES.quote.subject, vars));
      setBody(renderTemplate(DEFAULT_EMAIL_TEMPLATES.quote.body, vars));
      return;
    }
    const t = templates.find((x) => x.id === id);
    if (t) {
      setSubject(renderTemplate(t.subject, vars));
      setBody(renderTemplate(t.body, vars));
    }
  }

  async function send() {
    if (!recipient.trim()) { setError("Enter a recipient email address."); return; }
    setError("");
    setSending(true);
    try {
      const res = await fetch(`/api/quotes/${quoteId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recipient.trim(), subject, body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to send email");
      onSent(recipient.trim());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: c.panel, borderRadius: 12, width: 520, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${c.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: c.ink }}>Email quote</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: c.hint, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: "16px 20px" }}>
          {loading ? (
            <div style={{ fontSize: 13, color: c.hint, textAlign: "center", padding: "20px 0" }}>Loading templates…</div>
          ) : (
            <>
              {templates.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={lbl}>Template</label>
                  <select style={inp} value={templateId} onChange={(e) => selectTemplate(e.target.value)}>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>
                    ))}
                    <option value="__default__">Built-in default</option>
                  </select>
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>To</label>
                <input style={inp} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="customer@example.com" />
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={lbl}>Subject</label>
                <input style={inp} value={subject} onChange={(e) => setSubject(e.target.value)} />
                <div style={{ fontSize: 10.5, color: c.hint, marginTop: 4 }}>
                  If Gmail is connected (Settings → Connectors) and you use the same subject as the customer&apos;s original email, this send threads as a reply instead of starting a new conversation.
                </div>
              </div>

              <div style={{ marginBottom: 4 }}>
                <label style={lbl}>Body</label>
                <textarea style={{ ...inp, minHeight: 140, resize: "vertical", lineHeight: 1.5 }} value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
              <div style={{ fontSize: 11, color: c.hint, marginBottom: 12 }}>The quote PDF is attached automatically.</div>

              {error && <div style={{ fontSize: 12.5, color: "var(--err-ink)", marginBottom: 12 }}>{error}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 7, border: `1px solid ${c.line}`, background: "transparent", color: c.muted, fontSize: 13, cursor: "pointer" }}>Cancel</button>
                <button onClick={send} disabled={sending} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: c.accent, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: sending ? 0.6 : 1 }}>
                  {sending ? "Sending…" : "Send email"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
