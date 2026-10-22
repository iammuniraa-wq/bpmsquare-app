"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Tabs from "@/components/ui/Tabs";
import { useUrlTab } from "@/components/ui/useUrlTab";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { ACCENT_PRESETS, useSettings } from "@/lib/settings";
import { useTenant } from "@/lib/tenant-context";
import { APPEARANCE_TABS, type AppearanceTab } from "@/lib/settingsFolded";
import { appearanceDirty, draftFromTenant, parseTopics, planAppearanceSave, type AppearanceDraft } from "./appearanceLogic";
import ThemeTab from "./ThemeTab";
import MenuTab from "./MenuTab";
import DashboardTab from "./DashboardTab";
import s from "./appearance.module.css";

const LABEL: Record<AppearanceTab, string> = { theme: "Theme", menu: "Menu", dashboard: "Dashboard" };
const TABS = APPEARANCE_TABS;

/**
 * Settings > Appearance: Theme, Menu and Dashboard as three tabs over one draft and one Save. It replaces four menu
 * entries (Theme & colours, Navigation visibility, Reset layout, Dashboard content), which mixed choices that applied
 * at once with others that needed a Save.
 */
export default function AppearanceClient() {
  const router = useRouter();
  const tenant = useTenant();
  const { settings, reset: resetLocal } = useSettings();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;
  const [tab, setTab] = useUrlTab(TABS);

  const [initial, setInitial] = useState<AppearanceDraft>(() => draftFromTenant({ accent_color: tenant?.accent_color, config: tenant?.config }));
  const [draft, setDraft] = useState<AppearanceDraft>(initial);
  const [didReset, setDidReset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const dirty = appearanceDirty(initial, draft);
  const edit = (patch: Partial<AppearanceDraft>) => { setSaved(false); setDraft((d) => ({ ...d, ...patch })); };

  async function save() {
    const plan = planAppearanceSave(initial, draft, tenant?.config?.appearance);
    setSaving(true); setError(""); setSaved(false);
    const calls: { url: string; method: "PATCH"; body: unknown }[] = [];
    if (plan.workspace) calls.push({ url: "/api/settings/workspace", method: "PATCH", body: plan.workspace });
    if (plan.config) calls.push({ url: "/api/settings/entities", method: "PATCH", body: plan.config });
    for (const call of calls) {
      const res = await fetch(call.url, { method: call.method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(call.body) }).catch(() => null);
      if (!res || !res.ok) {
        setSaving(false);
        setError(res ? ((await res.json().catch(() => ({}))).error ?? "Could not save") : "Network error");
        return;
      }
    }
    if (didReset) resetLocal();
    setSaving(false);
    setInitial({ ...draft, topics: parseTopics(draft.topics).join(", ") });
    setDidReset(false);
    setSaved(true);
    // A theme or layout change swaps which components Shell mounts; a refresh would pair stale client state with
    // the new tree, so those reload the page.
    if (plan.reload) window.location.reload();
    else router.refresh();
  }

  return (
    <div className={s.shell}>
      <SettingsSave dirty={dirty} saving={saving} saved={saved} error={error} onSave={save} />
      <Tabs label="Appearance" tabs={TABS.map((id) => ({ id, label: LABEL[id] }))} value={tab} onChange={(id) => setTab(id)} />
      <div role="tabpanel" aria-label={LABEL[tab as AppearanceTab]}>
        {tab === "theme" && <ThemeTab draft={draft} features={tenant?.features} accent={accent} onChange={edit} />}
        {tab === "menu" && (
          <MenuTab
            hidden={draft.navHidden} features={tenant?.features} accent={accent}
            onChange={(navHidden) => edit({ navHidden })}
            onReset={() => { edit({ navHidden: [], compact: false }); setDidReset(true); }}
          />
        )}
        {tab === "dashboard" && <DashboardTab draft={draft} accent={accent} onChange={edit} />}
      </div>
    </div>
  );
}
