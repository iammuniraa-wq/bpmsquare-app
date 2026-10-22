"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { ACCENT_PRESETS, useSettings } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import type { ProductCategoryNode } from "@/lib/picklists";
import type { ResolvedItemType } from "@/lib/products/itemTypes";
import { PRODUCT_TABS, type ProductTab } from "@/lib/settingsFolded";
import { planProductSave } from "./productsLogic";
import CategoriesTab from "./CategoriesTab";
import TypesTab from "./TypesTab";
import s from "./products.module.css";

const LABEL: Record<ProductTab, string> = { categories: "Categories", types: "Item types" };

/**
 * Settings > Products: Categories and Item types as two tabs over one draft and one Save (they were two menu entries
 * with a Save each). Item types only exist where the Products module is on.
 */
export default function ProductsClient({ tree, types, usage, showTypes }: {
  tree: ProductCategoryNode[];
  types: ResolvedItemType[];
  usage: Record<string, number>;
  showTypes: boolean;
}) {
  const router = useRouter();
  const tenant = useTenant();
  const { settings } = useSettings();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const tabs = PRODUCT_TABS.filter((t) => t !== "types" || showTypes);
  const [tab, setTab] = useUrlTab(tabs);

  const [initial, setInitial] = useState({ tree, types });
  const [draft, setDraft] = useState({ tree, types });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const steps = planProductSave(initial, draft);
  const dirty = steps.length > 0;

  async function save() {
    setSaving(true); setError(""); setSaved(false);
    for (const step of steps) {
      const res = await fetch(step.url, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(step.body) }).catch(() => null);
      if (!res || !res.ok) {
        setSaving(false);
        setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not save") : "Network error");
        return;
      }
    }
    setSaving(false);
    setInitial(draft);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className={s.shell}>
      <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />
      {tabs.length > 1 && <Tabs label="Products" tabs={tabs.map((id) => ({ id, label: LABEL[id] }))} value={tab} onChange={(id) => setTab(id)} />}
      <div role="tabpanel" aria-label={LABEL[tab as ProductTab]}>
        {tab === "categories" && <CategoriesTab tree={draft.tree} onChange={(next) => { setSaved(false); setDraft((d) => ({ ...d, tree: next })); }} />}
        {tab === "types" && <TypesTab rows={draft.types} usage={usage} accent={accent} onChange={(next) => { setSaved(false); setDraft((d) => ({ ...d, types: next })); }} />}
      </div>
    </div>
  );
}
