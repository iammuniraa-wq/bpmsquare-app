import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import { getTenant } from "@/lib/tenant";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import ConnectorsClient from "./ConnectorsClient";

export default async function ConnectorsPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const tenant = await getTenant();
  const middlewareOn = tenant?.features?.integration_middleware === true;

  return (
    <>
      <SettingsPageHeader
        title="Connectors"
        subtitle="Connect BPMSquare to other systems your team already uses"
      />
      <ConnectorsClient middlewareOn={middlewareOn} />
    </>
  );
}
