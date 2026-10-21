"use client";

import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { AdminOnlyNotice } from "@/components/settings/generalShared";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import EmailOutputSection from "./EmailOutputSection";

export default function EmailOutputSectionPage() {
  const { settings } = useSettings();
  const tenant = useTenant();
  const role = useUserRole();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;

  return (
    <div style={{ maxWidth: 680 }}>
      <SettingsPageHeader title="Email output" info={SETTINGS_TIPS.emailOutput} />
      {role === "admin" ? <EmailOutputSection accent={accent} /> : <AdminOnlyNotice what="change where email is delivered" />}
    </div>
  );
}
