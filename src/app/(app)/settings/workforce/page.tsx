import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import { getWfmConfig } from "@/lib/wfm/server";
import PageHeader from "@/components/PageHeader";
import WorkforceSettingsTabs from "./WorkforceSettingsTabs";

export default async function SettingsWorkforcePage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const admin = createAdminSupabase();
  const { data } = await admin.from("tenants").select("features, config").eq("id", tenantId!).single();
  if (!data?.features?.wfm) redirect(ROUTES.settings);

  // Defaults filled in group by group (costing, notifications, ...), so a
  // tenant row written before a group existed never renders a blank form.
  const config = await getWfmConfig(admin, tenantId!);
  const projectsOn = data.features?.wfm_projects === true && data.features?.invoices === true;

  return (
    <>
      <PageHeader
        title="Workforce"
        subtitle="Attendance rules, sites, shifts, leave types and holidays — everything that shapes how the workforce punches in and takes leave."
      />
      <WorkforceSettingsTabs initial={config} projectsOn={projectsOn} />
    </>
  );
}
