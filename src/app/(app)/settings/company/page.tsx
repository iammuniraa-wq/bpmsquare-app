import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import CompanyClient from "./CompanyClient";
import { COMPANY_TIPS } from "./tips";

/** Settings > Company. Admin only: every write behind it (name, letterhead, tax, currency, ID format) is admin only. */
export default async function CompanyPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  return (
    <>
      <SettingsPageHeader title="Company" info={COMPANY_TIPS.page} />
      <Suspense fallback={null}>
        <CompanyClient />
      </Suspense>
    </>
  );
}
