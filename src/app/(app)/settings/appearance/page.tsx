import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { SETTINGS_TIPS } from "@/lib/settingsTips";
import AppearanceClient from "./AppearanceClient";

/** Settings > Appearance. Admin only: theme, colours, menu and dashboard apply to the whole workspace, and every write is an admin write. */
export default async function AppearancePage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  return (
    <>
      <SettingsPageHeader title="Appearance" info={SETTINGS_TIPS.appearance} />
      <Suspense fallback={null}>
        <AppearanceClient />
      </Suspense>
    </>
  );
}
