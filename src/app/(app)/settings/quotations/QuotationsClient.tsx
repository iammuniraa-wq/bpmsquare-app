"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { ACCENT_PRESETS, useSettings } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import type { QuoteStatusDef } from "@/lib/constants";
import type { EmailTemplate, TextFragment } from "@/lib/types";
import type { QuotationTab } from "@/lib/settingsFolded";
import {
  draftFrom, planQuotationsSave, quotationsDirty, quotationTabs, statusProblem, templateRows, type PrintField, type QuotationsDraft, type TemplateRow,
} from "./quotationsLogic";
import StatusesTab from "./StatusesTab";
import OfferTypesTab from "./OfferTypesTab";
import TemplatesTab from "./TemplatesTab";
import PrintTab from "./PrintTab";
import s from "./quotations.module.css";

const LABEL: Record<QuotationTab, string> = { statuses: "Statuses", types: "Offer types", templates: "Templates", print: "Print" };

/**
 * Settings > Quotations: four tabs that were five menu entries (Quote statuses, Quote types, Text templates, Email
 * templates, Asset print fields). Statuses, Offer types and Print share one draft and one Save; Templates are
 * records and save from their own panel.
 */
export default function QuotationsClient({ statuses, typeVisibility, printFields, printCustomFields, fragments, emails }: {
  statuses: QuoteStatusDef[] | null;
  typeVisibility: Partial<Record<string, boolean>> | null;
  printFields: string[];
  printCustomFields: PrintField[];
  fragments: TextFragment[];
  emails: EmailTemplate[];
}) {
  const router = useRouter();
  const tenant = useTenant();
  const { settings } = useSettings();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const features = tenant?.features;

  const tabs = useMemo(() => quotationTabs(features), [features]);
  const [tab, setTab] = useUrlTab(tabs);

  const [initial, setInitial] = useState<QuotationsDraft>(() => draftFrom(statuses, typeVisibility, printFields));
  const [draft, setDraft] = useState<QuotationsDraft>(initial);
  const [templates, setTemplates] = useState<TemplateRow[]>(() => templateRows(fragments, emails));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const dirty = quotationsDirty(initial, draft);
  const edit = (patch: Partial<QuotationsDraft>) => { setSaved(false); setError(""); setDraft((d) => ({ ...d, ...patch })); };

  async function save() {
    const problem = statusProblem(draft.statuses);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(""); setSaved(false);
    for (const step of planQuotationsSave(initial, draft)) {
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
    // Hidden offer types and the status list are read by the quote screens from the server layout.
    router.refresh();
  }

  return (
    <div className={s.shell}>
      {(tab !== "templates" || dirty) && <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />}
      {tabs.length > 1 && <Tabs label="Quotations" tabs={tabs.map((id) => ({ id, label: LABEL[id] }))} value={tab} onChange={(id) => setTab(id)} />}
      <div role="tabpanel" aria-label={LABEL[tab as QuotationTab]}>
        {tab === "statuses" && <StatusesTab statuses={draft.statuses} accent={accent} onChange={(next) => edit({ statuses: next })} />}
        {tab === "types" && <OfferTypesTab visibility={draft.types} accent={accent} onChange={(next) => edit({ types: next })} />}
        {tab === "templates" && <TemplatesTab rows={templates} accent={accent} onRows={setTemplates} />}
        {tab === "print" && <PrintTab fields={draft.print} customFields={printCustomFields} onChange={(next) => edit({ print: next })} />}
      </div>
    </div>
  );
}
