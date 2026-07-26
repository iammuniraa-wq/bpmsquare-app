"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data/labels";
import type { AccountType, MarketingTargetGroup } from "@/lib/types";

const ALL_TYPES: AccountType[] = ["direct", "end_customer", "oem", "prospect"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AccountLite = { id: string; name: string; type: AccountType };

/** Checkbox account-type filter + manual add/remove exceptions + hand-typed
 * external emails + a live "-> N recipients" preview, shared by the compose
 * page and the draft campaign detail page (same targeting rule, same
 * preview endpoint). Also offers loading/saving a named, reusable "target
 * group" built from this same rule shape. */
export default function TargetAudiencePicker({
  accounts,
  types, setTypes,
  includeIds, setIncludeIds,
  excludeIds, setExcludeIds,
  manualEmails, setManualEmails,
}: {
  accounts: AccountLite[];
  types: Set<AccountType>;
  setTypes: (next: Set<AccountType>) => void;
  includeIds: Set<string>;
  setIncludeIds: (next: Set<string>) => void;
  excludeIds: Set<string>;
  setExcludeIds: (next: Set<string>) => void;
  manualEmails: Set<string>;
  setManualEmails: (next: Set<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [emailError, setEmailError] = useState("");
  const [preview, setPreview] = useState<{ will_receive: number; opted_out: number; no_email: number } | null>(null);
  const [groups, setGroups] = useState<MarketingTargetGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  useEffect(() => {
    fetch("/api/marketing/target-groups").then((r) => r.json()).then((data) => setGroups(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  function loadGroup(id: string) {
    const group = groups.find((g) => g.id === id);
    if (!group) return;
    setTypes(new Set(group.account_types));
    setIncludeIds(new Set(group.include_account_ids));
    setExcludeIds(new Set(group.exclude_account_ids));
    setManualEmails(new Set(group.manual_emails));
    setSelectedGroupId(id);
  }

  async function saveAsGroup() {
    const name = window.prompt("Name this target group (e.g. \"OEM accounts, Mumbai\"):");
    if (!name?.trim()) return;
    setSavingGroup(true);
    try {
      const res = await fetch("/api/marketing/target-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          account_types: [...types],
          include_account_ids: [...includeIds],
          exclude_account_ids: [...excludeIds],
          manual_emails: [...manualEmails],
        }),
      });
      const saved = await res.json();
      if (res.ok) { setGroups((g) => [saved, ...g]); setSelectedGroupId(saved.id); }
    } finally {
      setSavingGroup(false);
    }
  }

  async function deleteGroup(id: string) {
    if (!window.confirm("Delete this saved target group? Campaigns already built from it are unaffected.")) return;
    setGroups((g) => g.filter((x) => x.id !== id));
    if (selectedGroupId === id) setSelectedGroupId("");
    await fetch(`/api/marketing/target-groups/${id}`, { method: "DELETE" });
  }

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

  const countByType = useMemo(() => {
    const m = new Map<AccountType, number>();
    for (const a of accounts) m.set(a.type, (m.get(a.type) ?? 0) + 1);
    return m;
  }, [accounts]);

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8);
  }, [search, accounts]);

  function toggleType(t: AccountType) {
    const next = new Set(types);
    if (next.has(t)) next.delete(t); else next.add(t);
    setTypes(next);
  }

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

  useEffect(() => {
    const rule = {
      account_types: [...types], include_account_ids: [...includeIds], exclude_account_ids: [...excludeIds],
      manual_emails: [...manualEmails],
    };
    const timer = setTimeout(() => {
      fetch("/api/marketing/recipients-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      })
        .then((r) => r.json())
        .then(setPreview)
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types, includeIds, excludeIds, manualEmails]);

  const lbl: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 600, color: c.muted,
    textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6,
  };
  const inp: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", border: `1px solid ${c.line}`, borderRadius: 8,
    padding: "8px 12px", fontSize: 13, color: c.ink, background: c.panel, outline: "none",
  };

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Target audience</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {groups.length > 0 && (
            <select
              value={selectedGroupId}
              onChange={(e) => { if (e.target.value) loadGroup(e.target.value); }}
              style={{ fontSize: 12, padding: "5px 8px", borderRadius: 6, border: `1px solid ${c.line}`, background: c.panel, color: c.ink }}
            >
              <option value="">Load a saved target group…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          {selectedGroupId && (
            <button onClick={() => deleteGroup(selectedGroupId)} style={{ fontSize: 11, color: "#dc2626", background: "none", border: "none", cursor: "pointer" }}>Delete group</button>
          )}
          <button onClick={saveAsGroup} disabled={savingGroup} style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 6, border: `1px solid ${c.accent}40`, background: c.accentbg, color: c.accent, fontWeight: 600, cursor: "pointer" }}>
            {savingGroup ? "Saving…" : "Save as target group"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
        {ALL_TYPES.map((t) => (
          <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: c.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={types.has(t)} onChange={() => toggleType(t)} />
            {ACCOUNT_TYPE_LABEL[t]} ({countByType.get(t) ?? 0})
          </label>
        ))}
      </div>

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
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
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

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
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

      {preview && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.line}`, fontSize: 13 }}>
          <strong style={{ color: c.ink }}>→ {preview.will_receive} recipient{preview.will_receive === 1 ? "" : "s"}</strong>
          {(preview.opted_out > 0 || preview.no_email > 0) && (
            <span style={{ color: c.hint, marginLeft: 8, fontSize: 12 }}>
              ({preview.opted_out > 0 ? `${preview.opted_out} opted out` : ""}{preview.opted_out > 0 && preview.no_email > 0 ? " · " : ""}{preview.no_email > 0 ? `${preview.no_email} no email on file` : ""})
            </span>
          )}
        </div>
      )}
    </section>
  );
}
