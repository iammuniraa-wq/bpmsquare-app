import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import CoverageSettingsClient from "./CoverageSettingsClient";

export default async function CoverageSettingsPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const tenant = await getTenant();
  if (!tenant?.features?.coverage_model) redirect(ROUTES.settings);

  return (
    <>
      <PageHeader
        title="Coverage"
        subtitle="Teams, rule-based segments and the coverage wiring that replaces flat territory/sales org assignment"
      />
      <CoverageSettingsClient />
    </>
  );
}
