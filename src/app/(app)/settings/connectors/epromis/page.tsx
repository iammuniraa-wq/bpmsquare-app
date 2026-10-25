import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import { EPROMIS_TIPS } from "@/lib/connectors/epromis/tips";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import EpromisClient from "./EpromisClient";

/** Settings -> Connectors -> ePROMIS. Admin only, and only in a workspace that has the tender module (the module it serves). */
export default async function EpromisPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  await requireFeature("gcc_tender");

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.settingsConnectors} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>← Connectors</Link>
      </div>
      <SettingsPageHeader title="ePROMIS" info={EPROMIS_TIPS.page} />
      <EpromisClient />
    </>
  );
}
