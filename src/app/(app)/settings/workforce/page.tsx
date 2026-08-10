import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES, DEFAULT_WFM_CONFIG, type TenantConfig, type WfmConfig } from "@/lib/constants";
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

  const stored = ((data?.config as TenantConfig | null)?.wfm ?? {}) as Partial<WfmConfig>;
  const config: WfmConfig = { ...DEFAULT_WFM_CONFIG, ...stored };

  return (
    <>
      <PageHeader
        title="Workforce"
        subtitle="Attendance rules, sites, shifts, leave types and holidays — everything that shapes how the workforce punches in and takes leave."
      />
      <WorkforceSettingsTabs initial={config} />
    </>
  );
}
