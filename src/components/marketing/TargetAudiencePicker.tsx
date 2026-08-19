"use client";

import { useEffect, useMemo, useState } from "react";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data/labels";
import { ROUTES } from "@/lib/constants";
import type { AccountType, MarketingTargetGroup } from "@/lib/types";
import type { SegmentFilter } from "@/lib/marketingSegmentation";
import { AccountIncludeExclude, ManualEmailChips, type AccountLite } from "./AudienceExtras";

const ALL_TYPES: AccountType[] = ["direct", "end_customer", "oem", "prospect"];

export type { AccountLite };

/** Checkbox account-type filter + manual add/remove exceptions + hand-typed
 * external emails + a live "-> N recipients" preview, shared by the compose
 * page and the draft campaign detail page (same targeting rule, same
 * preview endpoint). Also offers loading/saving a named, reusable "target
 * group" -- including ones built with rule-based conditions in the
 * Segmentation builder, which this picker can load and carry along (as
 * `filters`/`match`) but not edit -- editing those happens on the
 * Segmentation page itself. */
export default function TargetAudiencePicker({
  accounts,
  types, setTypes,
  includeIds, setIncludeIds,
  excludeIds, setExcludeIds,
  manualEmails, setManualEmails,
  filters, setFilters,
  match, setMatch,
  autoLoadGroupId,
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
  filters: SegmentFilter[];
  setFilters: (next: SegmentFilter[]) => void;
  match: "all" | "any";
  setMatch: (next: "all" | "any") => void;
  /** Pre-loads a saved target group once its list arrives -- used when
   * arriving from "Use in campaign" on the Segmentation list page. */
  autoLoadGroupId?: string;
}) {
  const [preview, setPreview] = useState<{ will_receive: number; opted_out: number; no_email: number } | null>(null);
  const [groups, setGroups] = useState<MarketingTargetGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  useEffect(() => {
    fetch("/api/marketing/target-groups").then((r) => r.json()).then((data) => setGroups(Array.isArray(data) ? data : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoLoadGroupId && groups.some((g) => g.id === autoLoadGroupId) && !selectedGroupId) {
      loadGroup(autoLoadGroupId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, autoLoadGroupId]);

  function loadGroup(id: string) {
    const group = groups.find((g) => g.id === id);
    if (!group) return;
    setTypes(new Set(group.account_types));
    setIncludeIds(new Set(group.include_account_ids));
    setExcludeIds(new Set(group.exclude_account_ids));
    setManualEmails(new Set(group.manual_emails));
    setFilters(group.filters ?? []);
    setMatch(group.match ?? "all");
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
          filters, match,
        }),
      });
      const saved = await res.json();
      if (res.ok) { setGroups((g) => [saved, ...g]); setSelectedGroupId(saved.id); }
    } finally {
      setSavingGroup(false);
    }
  }

  const { confirm } = useFeel();
  async function deleteGroup(id: string) {
    if (!(await confirm({ title: "Delete this saved target group?", body: "Campaigns already built from it are unaffected.", tone: "danger" }))) return;
    setGroups((g) => g.filter((x) => x.id !== id));
    if (selectedGroupId === id) setSelectedGroupId("");
    await fetch(`/api/marketing/target-groups/${id}`, { method: "DELETE" });
  }

  const countByType = useMemo(() => {
    const m = new Map<AccountType, number>();
    for (const a of accounts) m.set(a.type, (m.get(a.type) ?? 0) + 1);
    return m;
  }, [accounts]);

  function toggleType(t: AccountType) {
    const next = new Set(types);
    if (next.has(t)) next.delete(t); else next.add(t);
    setTypes(next);
  }

  useEffect(() => {
    const rule = {
      account_types: [...types], include_account_ids: [...includeIds], exclude_account_ids: [...excludeIds],
      manual_emails: [...manualEmails], filters, match,
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
  }, [types, includeIds, excludeIds, manualEmails, filters, match]);

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
            <button onClick={() => deleteGroup(selectedGroupId)} style={{ fontSize: 11, color: "var(--err-ink)", background: "none", border: "none", cursor: "pointer" }}>Delete group</button>
          )}
          <button onClick={saveAsGroup} disabled={savingGroup} style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 6, border: `1px solid ${c.accent}40`, background: c.accentbg, color: c.accent, fontWeight: 600, cursor: "pointer" }}>
            {savingGroup ? "Saving…" : "Save as target group"}
          </button>
        </div>
      </div>

      {filters.length > 0 ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, padding: "10px 12px", borderRadius: 8, background: c.accentbg, border: `1px solid ${c.accent}30` }}>
          <div style={{ fontSize: 12.5, color: c.ink }}>
            <strong>Advanced segment active</strong> — {filters.length} condition{filters.length === 1 ? "" : "s"}, match {match === "all" ? "ALL" : "ANY"}.
            {" "}Type filters below are ignored while this is active.{" "}
            <a href={ROUTES.marketingSegments} target="_blank" rel="noreferrer" style={{ color: c.accent, fontWeight: 600 }}>Edit in Segmentation ↗</a>
          </div>
          <button onClick={() => setFilters([])} style={{ fontSize: 11.5, flexShrink: 0, color: c.hint, background: "none", border: `1px solid ${c.line}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Clear</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
          {ALL_TYPES.map((t) => (
            <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: c.ink, cursor: "pointer" }}>
              <input type="checkbox" checked={types.has(t)} onChange={() => toggleType(t)} />
              {ACCOUNT_TYPE_LABEL[t]} ({countByType.get(t) ?? 0})
            </label>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <AccountIncludeExclude
          accounts={accounts}
          includeIds={includeIds} setIncludeIds={setIncludeIds}
          excludeIds={excludeIds} setExcludeIds={setExcludeIds}
        />
      </div>

      <div style={{ paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
        <ManualEmailChips manualEmails={manualEmails} setManualEmails={setManualEmails} />
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
