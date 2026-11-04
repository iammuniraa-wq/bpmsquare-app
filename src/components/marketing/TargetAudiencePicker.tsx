"use client";

import { useEffect, useMemo, useState } from "react";
import { useFeel } from "@/components/FeelProvider";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import { ACCOUNT_TYPE_LABEL } from "@/lib/data/labels";
import { ROUTES } from "@/lib/constants";
import type { AccountType, MarketingTargetGroup } from "@/lib/types";
import type { SegmentFilter } from "@/lib/marketingSegmentation";
import { AccountIncludeExclude, ManualEmailChips, type AccountLite, type AddressState } from "./AudienceExtras";
import AudienceCount from "./AudienceCount";
import ConsentChip from "./ConsentChip";
import InfoTip from "@/components/ui/InfoTip";
import { COMPOSE_TIPS } from "@/lib/marketing/composeTips";
import { useAudiencePreview } from "./useAudiencePreview";
import { EVERYONE, ruleKey } from "@/lib/marketing/audienceRule";

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
  autoLoadGroupId, showConsent = true, consentTopicLabel,
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
  /** Show the consent chip under the count (off when the page shows its own, as a newsletter campaign does). */
  showConsent?: boolean;
  consentTopicLabel?: string | null;
}) {
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
    const name = window.prompt("Name this audience (e.g. \"OEM accounts, Mumbai\"):");
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
    if (!(await confirm({ title: "Delete this saved audience?", body: "Campaigns already built from it are unaffected.", tone: "danger" }))) return;
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

  const { preview, checking, error: previewError } = useAudiencePreview({
    account_types: [...types], include_account_ids: [...includeIds], exclude_account_ids: [...excludeIds],
    manual_emails: [...manualEmails], filters, match,
  });

  // What will happen to a typed address, from the send's own decisions: absent from the left-out list = ready.
  const stateFor = (email: string): AddressState => {
    if (!preview) return null;
    const hit = preview.people.find((p) => (p.email ?? "").toLowerCase() === email);
    return hit ? { label: hit.label, why: hit.why, fix: hit.fix } : "ready";
  };

  // One audience concept: "everyone we can email", a saved audience, or a one-off that is being tuned. The select
  // shows which of the three the current rule IS, so editing a saved audience's rule honestly turns it into a one-off.
  const key = ruleKey({ types, includeIds, excludeIds, manualEmails, filters, match });
  const group = groups.find((g) => g.id === selectedGroupId);
  const groupMatches = !!group && ruleKey({
    types: new Set(group.account_types), includeIds: new Set(group.include_account_ids), excludeIds: new Set(group.exclude_account_ids),
    manualEmails: new Set(group.manual_emails), filters: group.filters ?? [], match: group.match ?? "all",
  }) === key;
  const mode: string = groupMatches ? selectedGroupId : key === ruleKey(EVERYONE) ? "all" : "custom";
  const [more, setMore] = useState(false);
  const customised = mode === "custom";

  function pick(value: string) {
    if (value === "all") {
      setTypes(new Set(ALL_TYPES)); setIncludeIds(new Set()); setExcludeIds(new Set()); setManualEmails(new Set()); setFilters([]); setMatch("all"); setSelectedGroupId("");
    } else if (value && value !== "custom") loadGroup(value);
    else setMore(true);
  }

  const small: React.CSSProperties = { fontSize: 12.5, padding: "0 12px", minHeight: 44, borderRadius: 8, cursor: "pointer", display: "inline-flex", alignItems: "center" };

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <label htmlFor="audience-pick" style={{ fontSize: 12.5, fontWeight: 700, color: c.ink }}>Audience</label>
        <InfoTip label="Audience">{COMPOSE_TIPS.audience}</InfoTip>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select
          id="audience-pick"
          value={mode}
          onChange={(e) => pick(e.target.value)}
          style={{ flex: "1 1 220px", minHeight: 44, fontSize: 13, padding: "0 10px", borderRadius: 8, border: `1px solid ${c.line}`, background: c.panel, color: c.ink }}
        >
          <option value="all">Everyone we can email</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          {customised && <option value="custom">One-off (changed here)</option>}
        </select>
        <button type="button" aria-expanded={more} onClick={() => setMore((v) => !v)} style={{ ...small, border: `1px solid ${c.line}`, background: c.panel, color: c.ink }}>{more ? "Less" : "More"}</button>
        {customised && (
          <button type="button" onClick={saveAsGroup} disabled={savingGroup} style={{ ...small, border: `1px solid ${c.accent}40`, background: c.accentbg, color: c.accent, fontWeight: 600 }}>
            {savingGroup ? "Saving…" : "Save as audience"}
          </button>
        )}
        {groupMatches && (
          <>
            <a href={ROUTES.marketingSegment(selectedGroupId)} target="_blank" rel="noreferrer" style={{ ...small, color: c.accent, fontWeight: 600, textDecoration: "none" }}>Edit audience</a>
            <button type="button" onClick={() => deleteGroup(selectedGroupId)} style={{ ...small, color: "var(--err-ink)", background: "none", border: "none" }}>Delete</button>
          </>
        )}
      </div>

      {more && (
        <div style={{ marginTop: 14 }}>
          {filters.length > 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14, padding: "10px 12px", borderRadius: 8, background: c.accentbg, border: `1px solid ${c.accent}30` }}>
              <div style={{ fontSize: 12.5, color: c.ink }}>
                <strong>Rule-based audience</strong>: {filters.length} condition{filters.length === 1 ? "" : "s"}, match {match === "all" ? "ALL" : "ANY"}.
                {" "}<a href={ROUTES.marketingSegments} target="_blank" rel="noreferrer" style={{ color: c.accent, fontWeight: 600 }}>Edit audience ↗</a>
              </div>
              <button type="button" onClick={() => setFilters([])} style={{ ...small, flexShrink: 0, color: c.hint, background: "none", border: `1px solid ${c.line}` }}>Clear</button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 14 }}>
              {ALL_TYPES.map((t) => (
                <label key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: c.ink, cursor: "pointer", minHeight: 44 }}>
                  <input type="checkbox" checked={types.has(t)} onChange={() => toggleType(t)} style={{ width: 20, height: 20 }} />
                  {ACCOUNT_TYPE_LABEL[t]} ({countByType.get(t) ?? 0})
                </label>
              ))}
            </div>
          )}
          <div style={{ marginBottom: 14 }}>
            <AccountIncludeExclude accounts={accounts} includeIds={includeIds} setIncludeIds={setIncludeIds} excludeIds={excludeIds} setExcludeIds={setExcludeIds} />
          </div>
          <div style={{ paddingTop: 14, borderTop: `1px solid ${c.line}` }}>
            <ManualEmailChips manualEmails={manualEmails} setManualEmails={setManualEmails} stateFor={stateFor} />
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${c.line}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: c.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Who will receive it</span>
          <InfoTip label="Who will receive it">{COMPOSE_TIPS.audienceCount}</InfoTip>
        </div>
        {previewError ? <div role="alert" style={{ fontSize: 12.5, color: "var(--err-ink)" }}>{previewError}</div> : <AudienceCount preview={preview} checking={checking} />}
      </div>
      {showConsent && <div style={{ marginTop: 6 }}><ConsentChip topicLabel={consentTopicLabel} /></div>}
    </section>
  );
}
