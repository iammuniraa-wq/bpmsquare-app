"use client";

import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { AdminOnlyNotice } from "@/components/settings/generalShared";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import CurrencySection from "./CurrencySection";

export default function CurrencySectionPage() {
  const { settings } = useSettings();
  const tenant = useTenant();
  const role = useUserRole();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Currency" info={SETTINGS_TIPS.currency} />
      {role === "admin" ? <CurrencySection accent={accent} /> : <AdminOnlyNotice what="change the workspace currency" />}
    </div>
  );
}
