"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import SettingsSection from "@/components/settings/SettingsSection";
import { settingsInput as inp } from "@/components/settings/SettingsField";

type Output = { mode: "partners" | "redirect"; redirect_to: string; forced: boolean };

/**
 * Email output channel (owner requirement 2026-09-06, after SAP C4C's Email
 * and Fax Settings). Two options and nothing in between:
 *
 *   1. Send to a specified email address -- every outbound email from any
 *      transaction goes to one internal inbox, tagged with who it was for.
 *   2. Send to business partners -- the address on the account, contact or
 *      employee record.
 *
 * On a demo workspace option 2 is not offered: redirect is enforced by the
 * server (src/lib/emailOutput.ts), and this screen only sets the inbox.
 */
export default function EmailOutputSection({ accent }: { accent: string }) {
  const [out, setOut] = useState<Output | null>(null);
  const [mode, setMode] = useState<"partners" | "redirect">("partners");
  const [addr, setAddr] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/email-output")
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j: Output | null) => {
        if (!j) return;
        setOut(j); setMode(j.mode); setAddr(j.redirect_to);
      })
      .catch(() => {});
  }, []);

  const dirty = !!out && (mode !== out.mode || addr.trim().toLowerCase() !== out.redirect_to);

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    const r = await fetch("/api/settings/email-output", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, redirect_to: addr.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (!r) { setError("Network error"); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "Could not save"); return; }
    setOut(j); setMode(j.mode); setAddr(j.redirect_to);
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  const summary = !out
    ? "Loading…"
    : out.mode === "redirect"
      ? out.redirect_to
        ? `Everything goes to ${out.redirect_to}${out.forced ? " (demo workspace)" : ""}`
        : "Redirect with no inbox set — nothing can be sent"
      : "Sent to the address on each account, contact or employee";

  const option = (value: "partners" | "redirect", title: string, body: string, disabled = false) => {
    const on = mode === value;
    return (
      <label
        style={{
          display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 8,
          border: `1px solid ${on ? accent : c.line}`, background: on ? "var(--panel)" : "transparent",
          cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
        }}
      >
        <input type="radio" name="email-output" checked={on} disabled={disabled} onChange={() => setMode(value)} style={{ marginTop: 2 }} />
        <span>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: c.ink }}>{title}</span>
          <span style={{ display: "block", fontSize: 12, color: c.muted, lineHeight: 1.45, marginTop: 2 }}>{body}</span>
        </span>
      </label>
    );
  };

  return (
    <div style={{ marginBottom: 12 }}>
      <SettingsSection id="general-email-output" title="Email output" summary={summary}>
        <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.5, marginBottom: 12 }}>
          Where quotations, invoices, campaigns and workforce notifications are actually delivered.
          {out?.forced && (
            <>
              {" "}<strong style={{ color: c.ink }}>This is a demo workspace:</strong> every outbound email is redirected to
              the inbox below, so no test document can reach a real customer. Only the inbox can be changed here.
            </>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {option(
            "redirect",
            "Send to a specified email address",
            "Every outbound email, from any transaction, goes to one internal inbox instead of the recipient on the document. The subject and body name who it was for, so output can still be checked end to end."
          )}
          {option(
            "partners",
            "Send to business partners",
            "Use the real email address on the account, contact or employee record. For production workspaces only.",
            out?.forced === true
          )}
        </div>

        {mode === "redirect" && (
          <div style={{ marginTop: 12, maxWidth: 420 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Redirect everything to</div>
            <input
              style={inp}
              type="email"
              placeholder="qa@yourcompany.com"
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
            />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            style={{
              padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 500, border: "none",
              cursor: dirty ? "pointer" : "default", background: dirty ? accent : c.line, color: dirty ? "#fff" : c.hint,
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span style={{ fontSize: 12.5, color: "var(--teal)", fontWeight: 500 }}>Saved</span>}
          {error && <span style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{error}</span>}
        </div>
      </SettingsSection>
    </div>
  );
}
