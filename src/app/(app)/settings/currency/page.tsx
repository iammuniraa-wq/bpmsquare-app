"use client";

import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { AdminOnlyNotice } from "@/components/settings/generalShared";
import CurrencySection from "./CurrencySection";

export default function CurrencySectionPage() {
  const { settings } = useSettings();
  const tenant = useTenant();
  const role = useUserRole();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Currency" subtitle="How every amount in this workspace is shown, printed and emailed." />
      {role === "admin" ? <CurrencySection accent={accent} /> : <AdminOnlyNotice what="change the workspace currency" />}
    </div>
  );
}
