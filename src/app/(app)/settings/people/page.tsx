import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import PeopleClient from "./PeopleClient";
import { PEOPLE_TIPS } from "./tips";

/**
 * Settings > People. Admin only, like the three screens it replaces (Settings > Team, Administration > Business
 * users, Administration > Business roles); every route it calls repeats the admin and tenant checks.
 */
export default async function PeoplePage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  return (
    <>
      <SettingsPageHeader title="People" info={PEOPLE_TIPS.page} />
      <Suspense fallback={null}>
        <PeopleClient />
      </Suspense>
    </>
  );
}
