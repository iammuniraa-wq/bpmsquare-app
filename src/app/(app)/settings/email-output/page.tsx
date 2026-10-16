"use client";

import { useSettings, ACCENT_PRESETS } from "@/lib/settings";
import { useTenant, useUserRole } from "@/lib/tenant-context";
import PageHeader from "@/components/PageHeader";
import { AdminOnlyNotice } from "@/components/settings/generalShared";
import EmailOutputSection from "./EmailOutputSection";

export default function EmailOutputSectionPage() {
  const { settings } = useSettings();
  const tenant = useTenant();
  const role = useUserRole();
  const accent = tenant?.accent_color || ACCENT_PRESETS[settings.accentPreset].color;

  return (
    <div style={{ maxWidth: 680 }}>
      <PageHeader title="Email output" subtitle="Where quotations, invoices, campaigns and workforce notifications are actually delivered." />
      {role === "admin" ? <EmailOutputSection accent={accent} /> : <AdminOnlyNotice what="change where email is delivered" />}
    </div>
  );
}
