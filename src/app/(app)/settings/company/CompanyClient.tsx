"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import EmptyState from "@/components/ui/EmptyState";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { ACCENT_PRESETS, useSettings } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import type { TenantConfig } from "@/lib/constants";
import type { CompanyInfo } from "@/lib/tenant";
import type { CompanyTab } from "@/lib/settingsFolded";
import { companyDirty, companyProblem, companyTabs, draftFrom, planCompanySave, printsLetterhead, visibleRanges, type CompanyDraft } from "./companyLogic";
import ProfileTab from "./ProfileTab";
import EntitiesTab from "./EntitiesTab";
import TaxTab from "./TaxTab";
import NumberingTab from "./NumberingTab";
import s from "./company.module.css";

const LABEL: Record<CompanyTab, string> = { profile: "Profile", entities: "Entities", tax: "Tax and currency", numbering: "Numbering" };

/**
 * Settings > Company: four tabs over one draft and one Save. Profile, Entities, Tax and currency, Numbering used to
 * be four menu entries (Company profile, Entities & Tax, Currency, Number ranges) with two company names and two
 * Save buttons; the tabs read and write the same routes they did.
 */
export default function CompanyClient() {
  const router = useRouter();
  const tenant = useTenant();
  const { settings } = useSettings();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const features = tenant?.features;

  const tabs = useMemo(() => companyTabs(features, visibleRanges(features).length > 0), [features]);
  const [tab, setTab] = useUrlTab(tabs);
  const letterhead = printsLetterhead(features);

  const [initial, setInitial] = useState<CompanyDraft | null>(null);
  const [draft, setDraft] = useState<CompanyDraft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [cfg, info, cur] = await Promise.all([
          fetch("/api/settings/entities").then((r) => r.json() as Promise<Partial<TenantConfig>>),
          fetch("/api/settings/company-info").then((r) => r.json() as Promise<CompanyInfo>),
          fetch("/api/settings/currency").then((r) => (r.ok ? r.json() : null)) as Promise<{ code?: string } | null>,
        ]);
        if (!live) return;
        const d = draftFrom(tenant?.name ?? "", info, cfg, cur?.code);
        setInitial(d);
        setDraft(d);
      } catch {
        if (live) setLoadError("Could not load the company details.");
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loadError) return <EmptyState title={loadError} />;
  if (!draft || !initial) return <div className="bpm-t-help" style={{ padding: 16 }}>Loading…</div>;

  const dirty = companyDirty(initial, draft);
  const edit = (patch: Partial<CompanyDraft>) => { setSaved(false); setDraft((d) => (d ? { ...d, ...patch } : d)); };
  const editProfile = (patch: Partial<CompanyDraft["profile"]>) => edit({ profile: { ...draft.profile, ...patch } });

  async function save() {
    if (!draft || !initial) return;
    const problem = companyProblem(draft);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(""); setSaved(false);
    for (const step of planCompanySave(initial, draft)) {
      const res = await fetch(step.url, { method: step.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(step.body) }).catch(() => null);
      if (!res || !res.ok) {
        setSaving(false);
        setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not save") : "Network error");
        return;
      }
    }
    setSaving(false);
    setInitial(draft);
    setSaved(true);
    // The sidebar name and every document read the workspace from the server layout.
    router.refresh();
  }

  return (
    <div className={s.shell}>
      <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />
      <Tabs label="Company" tabs={tabs.map((id) => ({ id, label: LABEL[id] }))} value={tab} onChange={(id) => setTab(id)} />
      <div role="tabpanel" aria-label={LABEL[tab as CompanyTab]}>
        {tab === "profile" && (
          <ProfileTab
            draft={draft} letterhead={letterhead}
            onName={(name) => edit({ name })} onPrintName={(printName) => edit({ printName })} onProfile={editProfile}
          />
        )}
        {tab === "entities" && <EntitiesTab entities={draft.entities} onChange={(entities) => edit({ entities })} />}
        {tab === "tax" && (
          <TaxTab
            currency={draft.currency} tax={draft.tax} showTax={letterhead} accent={accent}
            onCurrency={(currency) => edit({ currency })} onTax={(p) => edit({ tax: { ...draft.tax, ...p } })}
          />
        )}
        {tab === "numbering" && <NumberingTab features={features} format={draft.quoteFormat} onFormat={(p) => edit({ quoteFormat: { ...draft.quoteFormat, ...p } })} />}
      </div>
    </div>
  );
}
