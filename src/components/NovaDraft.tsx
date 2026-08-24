"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import { XIcon, CheckIcon } from "@/components/Icons";

// Theme-aware error ink (the raw #ff8a76 failed contrast on the light panel),
// and the real Nova CTA gradient token -- not a locally hand-picked one, so a
// tenant's custom accent (--nova-accent-color) carries through here too
// (2026-08-26 lock audit: this was a hardcoded duplicate with different stop
// colours than --nova-gradient-cta).
const ERR_INK = "var(--redink, #ff8a76)";
const NOVA_GRADIENT = "var(--nova-gradient-cta)";

/**
 * Nova pillar 2 — "paste anything, get a record". The review-first modal:
 * paste text → the extraction engine drafts a record → the human reviews a
 * form built from the tenant's live field config → confirm calls the
 * ordinary create API for that object (every existing validation and
 * guardrail applies unchanged).
 *
 * Four modes today: Account, Contact, Quote (header only — no line-item
 * extraction from a single paste, that's Data Workbench's job) and Product.
 * Contact and Quote both hang off an account, so their review step also
 * resolves one — an existing match found in the same text, or a new one
 * drafted alongside.
 *
 * Opened from the palette or the AI dock via the nova:open-draft event
 * ({ detail: { mode?, text? } }, mode defaults to "accounts"). Mounted once
 * in Shell, Nova tenants only.
 */

type DraftMode = "accounts" | "contacts" | "quotes" | "products";
type DraftField = { key: string; label: string; required: boolean; options: string[] | null; long: boolean };
type Phase = "input" | "drafting" | "review" | "creating";
type AccountRef = { id: string; name: string; ref?: string | null };

const MODE_META: Record<DraftMode, { label: string; sub: string; placeholder: string }> = {
  accounts: {
    label: "New account from paste",
    sub: "Paste an email, WhatsApp message, or signature — Nova drafts the record",
    placeholder: "e.g.\n\nHi, this is Ramesh from Deccan Polymers, Bellary. We need a quotation for rewinding two 45kW motors. You can reach me on 98450 12345 or ramesh@deccanpolymers.in — GSTIN 29ABCDE1234F1Z5.",
  },
  contacts: {
    label: "New contact from paste",
    sub: "Paste an email or message naming a person — Nova drafts the contact and finds their account",
    placeholder: "e.g.\n\nMeet Priya Sharma, procurement head at Deccan Polymers — priya@deccanpolymers.in, 98450 22345.",
  },
  quotes: {
    label: "New quote from paste",
    sub: "Paste a request for quotation — Nova drafts the header and finds the account",
    placeholder: "e.g.\n\nDeccan Polymers needs a quotation for rewinding two 45kW motors, urgent. Contact is Ramesh.",
  },
  products: {
    label: "New product from paste",
    sub: "Paste a spec sheet or catalog line — Nova drafts the product",
    placeholder: "e.g.\n\n45kW 3-phase induction motor, IE3 efficiency, foot-mounted. SKU MTR-45-IE3. List price ₹1,85,000.",
  },
};

const CREATE_LABEL: Record<DraftMode, string> = {
  accounts: "Create account",
  contacts: "Create contact",
  quotes: "Create quote",
  products: "Create product",
};

export default function NovaDraft() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<DraftMode>("accounts");
  const [phase, setPhase] = useState<Phase>("input");
  const [text, setText] = useState("");
  const [fields, setFields] = useState<DraftField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [moreFound, setMoreFound] = useState(0);
  const [error, setError] = useState("");

  // Optional companion contact — accounts mode drafts one from the same
  // text as a convenience; quotes mode offers the same "attach a contact"
  // checkbox for the account this quote is for.
  const [contactFields, setContactFields] = useState<DraftField[]>([]);
  const [contactValues, setContactValues] = useState<Record<string, string>>({});
  const [includeContact, setIncludeContact] = useState(false);
  const [createdContactId, setCreatedContactId] = useState<string | null>(null);

  // Account resolution — only used in contacts/quotes modes, where the
  // object being created REQUIRES an account. `accountDupes` are matches
  // found in the same text; `selectedAccountId` null means "create a new
  // one from the drafted fields below", set means "use this existing one".
  const [accountFields, setAccountFields] = useState<DraftField[]>([]);
  const [accountValues, setAccountValues] = useState<Record<string, string>>({});
  const [accountDupes, setAccountDupes] = useState<AccountRef[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  // Set once a NEW account actually gets created, so a retry never recreates it.
  const [createdAccount, setCreatedAccount] = useState<{ id: string; name: string } | null>(null);

  const [attaching, setAttaching] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  function resetDraft() {
    setFields([]); setValues({}); setNote(null); setMoreFound(0);
    setContactFields([]); setContactValues({}); setIncludeContact(false); setCreatedContactId(null);
    setAccountFields([]); setAccountValues({}); setAccountDupes([]); setSelectedAccountId(null);
    setCreatedAccount(null);
  }

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail ?? {};
      const carried = typeof detail.text === "string" ? detail.text : "";
      const requestedMode: DraftMode = detail.mode && detail.mode in MODE_META ? detail.mode : "accounts";
      setOpen(true); setPhase("input"); setText(carried); setError(""); setMode(requestedMode);
      resetDraft();
      // Text pasted into the palette arrives with the event -- start
      // drafting immediately instead of showing the same paste back.
      if (carried.trim().length >= 10) void draft(carried, requestedMode);
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

  async function draft(textArg?: string, modeArg?: DraftMode) {
    const payload = textArg ?? text;
    const m = modeArg ?? mode;
    setPhase("drafting"); setError("");
    try {
      const res = await fetch("/api/nova/draft", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ object: m, text: payload }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Drafting failed"); setPhase("input"); return; }

      setFields(json.fields ?? []);
      setValues(json.values ?? {});
      setNote(json.note ?? null);
      setMoreFound(json.more_found ?? 0);

      if (m === "accounts") {
        setAccountDupes(json.possible_duplicates ?? []);
        if (json.contact) {
          setContactFields(json.contact.fields ?? []);
          setContactValues(json.contact.values ?? {});
          setIncludeContact(true);
        } else {
          setContactFields([]); setContactValues({}); setIncludeContact(false);
        }
      } else if (m === "contacts" || m === "quotes") {
        const acct = json.account ?? null;
        setAccountFields(acct?.fields ?? []);
        setAccountValues(acct?.values ?? {});
        const dupes: AccountRef[] = acct?.possible_duplicates ?? [];
        setAccountDupes(dupes);
        // Default to the first existing match when one was found -- safer
        // than defaulting to "create a new one" and risking a duplicate.
        setSelectedAccountId(dupes.length > 0 ? dupes[0].id : null);
        if (m === "quotes" && json.contact) {
          setContactFields(json.contact.fields ?? []);
          setContactValues(json.contact.values ?? {});
          setIncludeContact(true);
        } else {
          setContactFields([]); setContactValues({}); setIncludeContact(false);
        }
      }

      setPhase("review");
    } catch {
      setError("Network error — try again."); setPhase("input");
    }
  }

  // "Open instead" (accounts mode only): the drafted contact travels to the
  // EXISTING account -- added there only if no contact with that name
  // already exists on it (case-insensitive; the tenant-scoped contacts list
  // is small and carries no PII, so the check is a simple client-side compare).
  async function openExisting(d: AccountRef) {
    const contactName = includeContact ? contactValues.name?.trim() : "";
    if (!contactName) { setOpen(false); router.push(ROUTES.account(d.id)); return; }
    setAttaching(d.id); setError("");
    try {
      const existing: { account_id: string; name: string }[] = await fetch("/api/contacts").then((r) => r.json());
      const already = Array.isArray(existing) && existing.some(
        (c) => c.account_id === d.id && c.name?.trim().toLowerCase() === contactName.toLowerCase()
      );
      if (!already) {
        const res = await fetch("/api/contacts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...toBody(contactValues), account_id: d.id }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(`Couldn't add ${contactName} to ${d.name}: ${j.error ?? "unknown error"}. Nothing else was changed.`);
          setAttaching(null);
          return;
        }
      }
      setOpen(false);
      router.push(ROUTES.account(d.id));
    } catch {
      setError("Network error — nothing was changed. Try again.");
      setAttaching(null);
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

  // Resolves the account for contacts/quotes mode: an already-selected
  // existing one, or creates a new one from the drafted fields (once —
  // a retry after a downstream failure reuses `createdAccount`).
  async function resolveAccount(): Promise<{ id: string; name: string } | null> {
    if (selectedAccountId) {
      const match = accountDupes.find((d) => d.id === selectedAccountId);
      return { id: selectedAccountId, name: match?.name ?? "" };
    }
    if (createdAccount) return createdAccount;
    const res = await fetch("/api/accounts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toBody(accountValues)),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "Could not create the account"); return null; }
    setCreatedAccount(json);
    return json;
  }

  async function create() {
    setPhase("creating"); setError("");
    try {
      if (mode === "products") {
        const res = await fetch("/api/products", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toBody(values)),
        });
        const json = await res.json();
        if (!res.ok) { setError(json.error ?? "Could not create the product"); setPhase("review"); return; }
        setOpen(false);
        router.push(ROUTES.product(json.id));
        return;
      }

      if (mode === "accounts") {
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
        router.push(ROUTES.account(account!.id));
        return;
      }

      // contacts / quotes -- resolve the account first (existing or new).
      const account = await resolveAccount();
      if (!account) { setPhase("review"); return; }

      if (mode === "contacts") {
        const res = await fetch("/api/contacts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...toBody(values), account_id: account.id }),
        });
        const json = await res.json();
        if (!res.ok) {
          setError(`Account ${account.name || "record"} is ready, but the contact failed: ${json.error ?? "unknown error"}. Fix and press Create again.`);
          setPhase("review");
          return;
        }
        setOpen(false);
        router.push(ROUTES.contact(json.id));
        return;
      }

      // quotes -- an attached contact is a convenience, never a blocker:
      // if it fails, the quote is still created without it.
      let contactId = createdContactId;
      if (includeContact && contactValues.name?.trim() && !contactId) {
        const res = await fetch("/api/contacts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...toBody(contactValues), account_id: account.id }),
        });
        const json = await res.json().catch(() => null);
        if (res.ok && json?.id) { contactId = json.id; setCreatedContactId(json.id); }
      }
      const res = await fetch("/api/quotes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...toBody(values), account_id: account.id, contact_id: contactId ?? undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(`Account ${account.name || "record"} is ready, but the quote failed: ${json.error ?? "unknown error"}. Fix and press Create again.`);
        setPhase("review");
        return;
      }
      setOpen(false);
      router.push(ROUTES.quotation(json.id));
    } catch {
      setError("Network error — check before retrying so nothing is created twice."); setPhase("review");
    }
  }

  if (!open) return null;

  function renderGrid(
    fs: DraftField[],
    vals: Record<string, string>,
    setVals: React.Dispatch<React.SetStateAction<Record<string, string>>>
  ) {
    return (
      <div className="novadraft-grid" style={{ display: "grid", gap: 10 }}>
        <style>{`
          .novadraft-grid { grid-template-columns: 1fr 1fr; }
          @media (max-width: 640px) { .novadraft-grid { grid-template-columns: 1fr; } }
        `}</style>
        {fs.map((f) => {
          const filled = !!vals[f.key]?.trim();
          // Empty optional fields collapse out of the way -- the review
          // should read as "check these", not a blank form.
          if (!filled && !f.required) return null;
          return (
            <div key={f.key} style={{ gridColumn: f.long ? "1 / -1" : "auto" }}>
              <label style={labelStyle}>
                {f.label}{f.required && <span style={{ color: ERR_INK }}> *</span>}
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

  const meta = MODE_META[mode];
  const needsAccount = mode === "contacts" || mode === "quotes";
  const accountResolved = needsAccount
    ? (selectedAccountId ? accountDupes.find((d) => d.id === selectedAccountId) ?? null : createdAccount)
    : null;

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
        role="dialog" aria-label={meta.label}
        style={{
          width: 560, maxWidth: "100%",
          background: "var(--sb-panel-bg)", border: "1px solid var(--sb-panel-border)",
          borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.55)", overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "13px 16px", borderBottom: "1px solid var(--sb-panel-border)" }}>
          <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ color: "var(--nova-pink)" }}>
            <path d="M8 1.5 9.4 6 14 7.4 9.4 8.8 8 13.3 6.6 8.8 2 7.4 6.6 6 8 1.5Z" fill="currentColor" />
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--sb-panel-text)" }}>{meta.label}</div>
            <div style={{ fontSize: 11, color: "var(--sb-panel-text-dim)" }}>
              {phase === "review" ? "Review the draft — nothing is saved until you create it" : meta.sub}
            </div>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close"
            style={{ border: "none", background: "transparent", color: "var(--sb-panel-text-dim)", cursor: "pointer", padding: 4, display: "flex" }}>
            <XIcon size={15} color="currentColor" />
          </button>
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
                placeholder={meta.placeholder}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {error && <span style={{ fontSize: 12, color: ERR_INK, flex: 1 }}>{error}</span>}
                <button
                  onClick={() => draft()}
                  disabled={phase === "drafting" || text.trim().length < 10}
                  style={{
                    marginLeft: "auto", border: "none", cursor: "pointer", font: "inherit",
                    fontSize: 12.5, fontWeight: 700, color: "#fff", padding: "9px 18px", borderRadius: 9,
                    background: NOVA_GRADIENT,
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
              {mode === "accounts" && accountDupes.length > 0 && !createdAccount && (
                <div style={{
                  fontSize: 12, lineHeight: 1.55, color: "var(--sb-panel-text)",
                  background: "color-mix(in srgb, var(--amberink, #f4b740) 13%, transparent)", border: "1px solid color-mix(in srgb, var(--amberink, #f4b740) 40%, transparent)",
                  borderRadius: 9, padding: "10px 12px",
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  <span style={{ fontWeight: 700 }}>This account may already exist:</span>
                  {accountDupes.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => openExisting(d)}
                      disabled={!!attaching}
                      style={{
                        textAlign: "left", cursor: "pointer", font: "inherit", fontSize: 12,
                        border: "none", background: "transparent", padding: 0,
                        color: "var(--nova-pink)", fontWeight: 650,
                        opacity: attaching && attaching !== d.id ? .5 : 1,
                      }}
                    >
                      {attaching === d.id ? "Adding contact…" : <>{d.name}{d.ref ? ` · ${d.ref}` : ""} — open instead →</>}
                    </button>
                  ))}
                  <span style={{ fontSize: 11, color: "var(--sb-panel-text-dim)" }}>
                    {includeContact && contactValues.name?.trim()
                      ? `Opening an existing account takes ${contactValues.name.trim()} along — added there only if not already a contact.`
                      : "Or continue below to create a new one anyway."}
                  </span>
                </div>
              )}

              {(note || moreFound > 0) && (
                <div style={{
                  fontSize: 11.5, lineHeight: 1.5, color: "var(--sb-panel-text)",
                  background: "color-mix(in srgb, var(--nova-pink) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--nova-pink) 25%, transparent)",
                  borderRadius: 9, padding: "9px 12px",
                }}>
                  {note}{note && moreFound > 0 ? " · " : ""}
                  {moreFound > 0 ? `${moreFound} more possible record${moreFound === 1 ? "" : "s"} in that text — use Data Workbench for bulk.` : ""}
                </div>
              )}

              {needsAccount && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <label style={labelStyle}>Account<span style={{ color: ERR_INK }}> *</span></label>
                  {accountDupes.length > 0 && (
                    <select
                      value={selectedAccountId ?? "__new__"}
                      onChange={(e) => setSelectedAccountId(e.target.value === "__new__" ? null : e.target.value)}
                      disabled={!!createdAccount}
                      style={inputStyle}
                    >
                      {accountDupes.map((d) => (
                        <option key={d.id} value={d.id}>{d.name}{d.ref ? ` · ${d.ref}` : ""}</option>
                      ))}
                      <option value="__new__">— Create a new account —</option>
                    </select>
                  )}
                  {accountResolved ? (
                    <div style={{
                      fontSize: 12.5, fontWeight: 600, color: "var(--sb-panel-text)",
                      background: "color-mix(in srgb, var(--greenink, #3ecf8e) 13%, transparent)", border: "1px solid color-mix(in srgb, var(--greenink, #3ecf8e) 40%, transparent)",
                      borderRadius: 9, padding: "9px 12px",
                    }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <CheckIcon size={12} color="currentColor" /> Using {accountResolved.name}
                      </span>
                    </div>
                  ) : (
                    accountFields.length > 0 && renderGrid(accountFields, accountValues, setAccountValues)
                  )}
                </div>
              )}

              {fields.length > 0 && (
                <div style={{ paddingTop: needsAccount ? 4 : 0, borderTop: needsAccount ? "1px solid var(--sb-panel-border)" : "none" }}>
                  {renderGrid(fields, values, setValues)}
                </div>
              )}

              {(mode === "accounts" || mode === "quotes") && contactFields.length > 0 && (
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
                    Also {mode === "accounts" ? "create" : "attach"} the contact person found in the text
                  </label>
                  {includeContact && renderGrid(contactFields, contactValues, setContactValues)}
                </>
              )}

              <div style={{ fontSize: 10.5, color: "var(--sb-panel-text-dim)" }}>
                Only extracted and required fields are shown — everything else stays editable after creation.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {error && <span style={{ fontSize: 12, color: ERR_INK, flex: 1 }}>{error}</span>}
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
                    background: NOVA_GRADIENT,
                    opacity: phase === "creating" ? .55 : 1,
                  }}
                >
                  {phase === "creating" ? "Creating…"
                    : mode === "accounts" && createdAccount ? "Retry contact"
                    : mode === "accounts" && includeContact && contactValues.name?.trim() ? "Create account + contact"
                    : CREATE_LABEL[mode]}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
