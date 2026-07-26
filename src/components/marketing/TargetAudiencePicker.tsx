"use client";

import { useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data/labels";
import type { AccountType } from "@/lib/types";

const ALL_TYPES: AccountType[] = ["direct", "end_customer", "oem", "prospect"];

export type AccountLite = { id: string; name: string; type: AccountType };

/** Checkbox account-type filter + manual add/remove exceptions + a live
 * "-> N recipients" preview, shared by the compose page and the draft
 * campaign detail page (same targeting rule, same preview endpoint). */
export default function TargetAudiencePicker({
  accounts,
  types, setTypes,
  includeIds, setIncludeIds,
  excludeIds, setExcludeIds,
}: {
  accounts: AccountLite[];
  types: Set<AccountType>;
  setTypes: (next: Set<AccountType>) => void;
  includeIds: Set<string>;
  setIncludeIds: (next: Set<string>) => void;
  excludeIds: Set<string>;
  setExcludeIds: (next: Set<string>) => void;
}) {
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{ will_receive: number; opted_out: number; no_email: number } | null>(null);

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
    const rule = { account_types: [...types], include_account_ids: [...includeIds], exclude_account_ids: [...excludeIds] };
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
  }, [types, includeIds, excludeIds]);

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
      <div style={{ fontSize: 12.5, fontWeight: 700, color: c.ink, marginBottom: 10 }}>Target audience</div>
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
