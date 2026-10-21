"use client";

import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { AdminOnlyNotice } from "@/components/settings/generalShared";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import DashboardContentSection from "./DashboardContentSection";

export default function DashboardContentSectionPage() {
  const { settings } = useSettings();
  const tenant = useTenant();
  const role = useUserRole();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Dashboard content" info={SETTINGS_TIPS.dashboardContent} />
      {role === "admin" ? <DashboardContentSection accent={accent} /> : <AdminOnlyNotice what="change the dashboard content" />}
    </div>
  );
}
