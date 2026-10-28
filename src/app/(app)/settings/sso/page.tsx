import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import StatusPill from "@/components/ui/StatusPill";
import { SSO_TIPS } from "./tips";

/**
 * Settings > Single sign-on. Holds its place in the menu until sign-in through the company identity provider exists;
 * it has no form on purpose. Admin only, like Settings > People.
 */
export default async function SsoPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  return (
    <>
      <SettingsPageHeader title="Single sign-on" info={SSO_TIPS.page} />
      <StatusPill label="Coming soon" tone="amber" />
    </>
  );
}
