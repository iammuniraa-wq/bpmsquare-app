"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { celebrate } from "@/lib/celebrate";

/**
 * Nova pillar 2 — "paste anything, get a record". The review-first modal:
 * paste text → the extraction engine drafts an Account → the human reviews
 * a form built from the tenant's live field config → confirm calls the
 * ordinary POST /api/accounts (every validation and guardrail unchanged).
 *
 * Opened from the palette ("New account from paste") via the
 * nova:open-draft event. Mounted once in Shell, Nova tenants only.
 */

type DraftField = { key: string; label: string; required: boolean; options: string[] | null; long: boolean };

type Phase = "input" | "drafting" | "review" | "creating";

export default function NovaDraft() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [fields, setFields] = useState<DraftField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [moreFound, setMoreFound] = useState(0);
  const [error, setError] = useState("");
  // Contact person drafted from the same text (null when none was found or
  // the tenant has no contacts module).
  const [contactFields, setContactFields] = useState<DraftField[]>([]);
  const [contactValues, setContactValues] = useState<Record<string, string>>({});
  const [includeContact, setIncludeContact] = useState(false);
  // Set once the account exists, so a contact retry never re-creates it.
  const [createdAccount, setCreatedAccount] = useState<{ id: string; name: string; territory_discovery?: string } | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      const carried = (e as CustomEvent).detail?.text;
      const initial = typeof carried === "string" ? carried : "";
      setOpen(true); setPhase("input"); setText(initial); setError("");
      setFields([]); setValues({}); setNote(null); setMoreFound(0);
      setContactFields([]); setContactValues({}); setIncludeContact(false); setCreatedAccount(null);
      // Text pasted into the palette arrives with the event -- start
      // drafting immediately instead of showing the same paste back.
      if (initial.trim().length >= 10) void draft(initial);
      else setTimeout(() => textRef.current?.focus(), 10);
    }
    window.addEventListener("nova:open-draft", onOpen);
    return () => window.removeEventListener("nova:open-draft", onOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  async function draft(textArg?: string) {
    const payload = textArg ?? text;
    setPhase("drafting"); setError("");
    try {
      const res = await fetch("/api/nova/draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: "accounts", text: payload }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Drafting failed"); setPhase("input"); return; }
      setFields(json.fields ?? []);
      setValues(json.values ?? {});
      setNote(json.note ?? null);
      setMoreFound(json.more_found ?? 0);
      if (json.contact) {
        setContactFields(json.contact.fields ?? []);
        setContactValues(json.contact.values ?? {});
        setIncludeContact(true);
      } else {
        setContactFields([]); setContactValues({}); setIncludeContact(false);
      }
      setPhase("review");
    } catch {
      setError("Network error — try again."); setPhase("input");
    }
  }

  function toBody(vals: Record<string, string>): Record<string, unknown> {
    const body: Record<string, unknown> = {};
    const customData: Record<string, string> = {};
    for (const [k, v] of Object.entries(vals)) {
      if (!v?.trim()) continue;
      if (k.startsWith("cf_")) customData[k] = v.trim();
      else body[k] = v.trim();
    }
    if (Object.keys(customData).length > 0) body.custom_data = customData;
    return body;
  }

  async function create() {
    setPhase("creating"); setError("");
    try {
      // Account first -- created exactly once; a contact retry reuses it.
      let account = createdAccount;
      if (!account) {
        const res = await fetch("/api/accounts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toBody(values)),
        });
        const json = await res.json();
        if (!res.ok) { setError(json.error ?? "Could not create the account"); setPhase("review"); return; }
        account = json;
        setCreatedAccount(json);
      }

      if (includeContact && contactValues.name?.trim()) {
        const res = await fetch("/api/contacts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...toBody(contactValues), account_id: account!.id }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(`Account ${account!.name} was created, but the contact failed: ${j.error ?? "unknown error"}. Fix and press Create again — only the contact will retry.`);
          setPhase("review");
          return;
        }
      }

      setOpen(false);
      if (account!.territory_discovery) {
        celebrate("New territory opened!", `${account!.name} is your first account in ${account!.territory_discovery} — the map just got bigger.`);
      }
      router.push(ROUTES.account(account!.id));
    } catch {
      setError("Network error — check Accounts before retrying so nothing is created twice."); setPhase("review");
    }
  }

  if (!open) return null;

  function renderGrid(
    fs: DraftField[],
    vals: Record<string, string>,
    setVals: React.Dispatch<React.SetStateAction<Record<string, string>>>
  ) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {fs.map((f) => {
          const filled = !!vals[f.key]?.trim();
          // Empty optional fields collapse out of the way -- the review
          // should read as "check these", not a blank form.
          if (!filled && !f.required) return null;
          return (
            <div key={f.key} style={{ gridColumn: f.long ? "1 / -1" : "auto" }}>
              <label style={labelStyle}>
                {f.label}{f.required && <span style={{ color: "#ff8a76" }}> *</span>}
              </label>
              {f.options ? (
                <select value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} style={inputStyle}>
                  <option value="">—</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : f.long ? (
                <textarea value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} rows={2} style={{ ...inputStyle, resize: "vertical" }} />
              ) : (
                <input value={vals[f.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [f.key]: e.target.value }))} style={inputStyle} />
              )}
            </div>
          );
        })}
      </div>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "7px 10px", borderRadius: 8, fontSize: 13,
    border: "1px solid var(--sb-panel-border)", background: "transparent",
    color: "var(--sb-panel-text)", fontFamily: "inherit", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
    color: "var(--sb-panel-text-dim)", marginBottom: 4, display: "block",
  };

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: "fixed", inset: 0, zIndex: 910,
        background: "rgba(5, 10, 18, .55)", backdropFilter: "blur(2px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "9vh 16px 16px", overflowY: "auto",
      }}
    >
      <div
        role="dialog" aria-label="New account from paste"
        style={{
          width: 560, maxWidth: "100%",
          background: "var(--sb-panel-bg)", border: "1px solid var(--sb-panel-border)",
          borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.55)", overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 16px", borderBottom: "1px solid var(--sb-panel-border)" }}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ color: "var(--modern-accent, var(--accent))" }}>
            <path d="M8 1.5 9.4 6 14 7.4 9.4 8.8 8 13.3 6.6 8.8 2 7.4 6.6 6 8 1.5Z" fill="currentColor" />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--sb-panel-text)" }}>New account from paste</div>
            <div style={{ fontSize: 11, color: "var(--sb-panel-text-dim)" }}>
              {phase === "review" ? "Review the draft — nothing is saved until you create it" : "Paste an email, WhatsApp message, or signature — Nova drafts the record"}
            </div>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close"
            style={{ border: "none", background: "transparent", color: "var(--sb-panel-text-dim)", fontSize: 16, cursor: "pointer", padding: 4 }}>×</button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {(phase === "input" || phase === "drafting") && (
            <>
              <textarea
                ref={textRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={phase === "drafting"}
                rows={9}
                placeholder={"e.g.\n\nHi, this is Ramesh from Deccan Polymers, Bellary. We need a quotation for rewinding two 45kW motors. You can reach me on 98450 12345 or ramesh@deccanpolymers.in — GSTIN 29ABCDE1234F1Z5."}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {error && <span style={{ fontSize: 12, color: "#ff8a76", flex: 1 }}>{error}</span>}
                <button
                  onClick={() => draft()}
                  disabled={phase === "drafting" || text.trim().length < 10}
                  style={{
                    marginLeft: "auto", border: "none", cursor: "pointer", font: "inherit",
                    fontSize: 12.5, fontWeight: 700, color: "#fff", padding: "9px 18px", borderRadius: 9,
                    background: "linear-gradient(135deg, #8b6cff, #ff6fae)",
                    opacity: phase === "drafting" || text.trim().length < 10 ? .55 : 1,
                  }}
                >
                  {phase === "drafting" ? "Drafting…" : "Draft it"}
                </button>
              </div>
            </>
          )}

          {(phase === "review" || phase === "creating") && (
            <>
              {(note || moreFound > 0) && (
                <div style={{
                  fontSize: 11.5, lineHeight: 1.5, color: "var(--sb-panel-text)",
                  background: "color-mix(in srgb, var(--modern-accent, var(--accent)) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--modern-accent, var(--accent)) 25%, transparent)",
                  borderRadius: 9, padding: "9px 12px",
                }}>
                  {note}{note && moreFound > 0 ? " · " : ""}
                  {moreFound > 0 ? `${moreFound} more possible record${moreFound === 1 ? "" : "s"} in that text — use Data Workbench for bulk.` : ""}
                </div>
              )}
              {createdAccount ? (
                <div style={{
                  fontSize: 12.5, fontWeight: 600, color: "var(--sb-panel-text)",
                  background: "rgba(62,207,142,.12)", border: "1px solid rgba(62,207,142,.4)",
                  borderRadius: 9, padding: "9px 12px",
                }}>
                  ✓ Account {createdAccount.name} created — only the contact below will be retried.
                </div>
              ) : (
                renderGrid(fields, values, setValues)
              )}

              {contactFields.length > 0 && (
                <>
                  <label style={{
                    display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                    paddingTop: 10, borderTop: "1px solid var(--sb-panel-border)",
                    fontSize: 12.5, fontWeight: 650, color: "var(--sb-panel-text)",
                  }}>
                    <input
                      type="checkbox"
                      checked={includeContact}
                      onChange={(e) => setIncludeContact(e.target.checked)}
                      style={{ width: 15, height: 15, cursor: "pointer" }}
                    />
                    Also create the contact person found in the text
                  </label>
                  {includeContact && renderGrid(contactFields, contactValues, setContactValues)}
                </>
              )}

              <div style={{ fontSize: 10.5, color: "var(--sb-panel-text-dim)" }}>
                Only extracted and required fields are shown — everything else stays editable after creation.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {error && <span style={{ fontSize: 12, color: "#ff8a76", flex: 1 }}>{error}</span>}
                <button
                  onClick={() => { setPhase("input"); setError(""); }}
                  disabled={phase === "creating" || !!createdAccount}
                  style={{
                    marginLeft: "auto", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600,
                    padding: "8px 14px", borderRadius: 9, background: "transparent",
                    border: "1px solid var(--sb-panel-border)", color: "var(--sb-panel-text-dim)",
                  }}
                >
                  Back
                </button>
                <button
                  onClick={create}
                  disabled={phase === "creating"}
                  style={{
                    border: "none", cursor: "pointer", font: "inherit",
                    fontSize: 12.5, fontWeight: 700, color: "#fff", padding: "9px 18px", borderRadius: 9,
                    background: "linear-gradient(135deg, #8b6cff, #ff6fae)",
                    opacity: phase === "creating" ? .55 : 1,
                  }}
                >
                  {phase === "creating" ? "Creating…"
                    : createdAccount ? "Retry contact"
                    : includeContact && contactValues.name?.trim() ? "Create account + contact"
                    : "Create account"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
