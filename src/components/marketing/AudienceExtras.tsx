"use client";

import { useMemo, useState } from "react";
import { c } from "@/lib/theme";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data/labels";
import type { AccountType } from "@/lib/types";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AccountLite = { id: string; name: string; type: AccountType };

const lbl: React.CSSProperties = {
  display: "block", fontSize: 11, fontWeight: 600, color: c.muted,
  textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
};
const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 8,
  padding: "8px 12px", fontSize: 13, color: c.ink, background: c.panel, outline: "none",
};

/** Search-to-add/exclude specific accounts, regardless of any type filter or
 * segmentation rule -- shared between the quick TargetAudiencePicker and the
 * rule-based Segmentation builder so "manual exceptions" behave identically
 * in both. */
export function AccountIncludeExclude({
  accounts, includeIds, setIncludeIds, excludeIds, setExcludeIds,
}: {
  accounts: AccountLite[];
  includeIds: Set<string>;
  setIncludeIds: (next: Set<string>) => void;
  excludeIds: Set<string>;
  setExcludeIds: (next: Set<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8);
  }, [search, accounts]);

  function addManual(id: string, which: "include" | "exclude") {
    setSearch("");
    if (which === "include") {
      const nextInclude = new Set(includeIds).add(id);
      const nextExclude = new Set(excludeIds); nextExclude.delete(id);
      setIncludeIds(nextInclude); setExcludeIds(nextExclude);
    } else {
      const nextExclude = new Set(excludeIds).add(id);
      const nextInclude = new Set(includeIds); nextInclude.delete(id);
      setExcludeIds(nextExclude); setIncludeIds(nextInclude);
    }
  }

  function removeManual(id: string) {
    const nextInclude = new Set(includeIds); nextInclude.delete(id);
    const nextExclude = new Set(excludeIds); nextExclude.delete(id);
    setIncludeIds(nextInclude); setExcludeIds(nextExclude);
  }

  return (
    <div>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <label style={lbl}>Add or remove specific accounts</label>
        <input style={inp} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts by name…" />
        {searchResults.length > 0 && (
          <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: c.panel, border: `1px solid ${c.line}`, borderRadius: 8, marginTop: 4, boxShadow: "0 8px 24px rgba(0,0,0,.1)", overflow: "hidden" }}>
            {searchResults.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: `1px solid ${c.line}` }}>
                <span style={{ fontSize: 13, color: c.ink }}>{a.name} <span style={{ color: c.hint, fontSize: 11 }}>({ACCOUNT_TYPE_LABEL[a.type]})</span></span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => addManual(a.id, "include")} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: `1px solid ${c.accent}40`, background: c.accentbg, color: c.accent, cursor: "pointer" }}>+ Add</button>
                  <button onClick={() => addManual(a.id, "exclude")} style={{ fontSize: 11, padding: "3px 8px", borderRadius: 5, border: "1px solid #fecaca", background: "#fef2f2", color: "#dc2626", cursor: "pointer" }}>− Exclude</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(includeIds.size > 0 || excludeIds.size > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {[...includeIds].map((id) => (
            <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, padding: "3px 8px", borderRadius: 5, background: c.accentbg, color: c.accent }}>
              + {accountsById.get(id)?.name ?? id}
              <button onClick={() => removeManual(id)} style={{ background: "none", border: "none", color: c.accent, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          ))}
          {[...excludeIds].map((id) => (
            <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, padding: "3px 8px", borderRadius: 5, background: "#fef2f2", color: "#dc2626" }}>
              − {accountsById.get(id)?.name ?? id}
              <button onClick={() => removeManual(id)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Hand-typed email addresses not tied to any account row -- shared between
 * the quick picker and the Segmentation builder. */
export function ManualEmailChips({
  manualEmails, setManualEmails,
}: {
  manualEmails: Set<string>;
  setManualEmails: (next: Set<string>) => void;
}) {
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");

  function addManualEmail() {
    const email = emailInput.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) { setEmailError("Enter a valid email address."); return; }
    setEmailError("");
    setManualEmails(new Set(manualEmails).add(email));
    setEmailInput("");
  }

  function removeManualEmail(email: string) {
    const next = new Set(manualEmails);
    next.delete(email);
    setManualEmails(next);
  }

  return (
    <div>
      <label style={lbl}>Also send to emails not in the system</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={inp}
          value={emailInput}
          onChange={(e) => { setEmailInput(e.target.value); setEmailError(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualEmail(); } }}
          placeholder="name@example.com"
        />
        <button onClick={addManualEmail} style={{ flexShrink: 0, fontSize: 12, padding: "8px 14px", borderRadius: 8, border: `1px solid ${c.accent}40`, background: c.accentbg, color: c.accent, fontWeight: 600, cursor: "pointer" }}>Add</button>
      </div>
      {emailError && <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{emailError}</div>}
      {manualEmails.size > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {[...manualEmails].map((email) => (
            <span key={email} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, padding: "3px 8px", borderRadius: 5, background: c.panel2, color: c.ink, border: `1px solid ${c.line}` }}>
              {email}
              <button onClick={() => removeManualEmail(email)} style={{ background: "none", border: "none", color: c.hint, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
