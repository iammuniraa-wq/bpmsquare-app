import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import D365Client from "./D365Client";

export default async function Dynamics365Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  // With the Integration middleware on, connection and sync both live on that page. The sign-in
  // callback still lands here, so its result (d365_connected / d365_error) is carried across.
  const tenant = await getTenant();
  if (tenant?.features?.integration_middleware === true) {
    const sp = await searchParams;
    const carry = new URLSearchParams({ connector: "dynamics365" });
    for (const k of ["d365_connected", "d365_error"]) {
      const v = sp[k];
      if (typeof v === "string") carry.set(k, v);
    }
    redirect(`${ROUTES.settingsMiddleware}?${carry.toString()}`);
  }

  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.settingsConnectors} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>← Connectors</Link>
      </div>
      <SettingsPageHeader title="Microsoft Dynamics 365" subtitle="Sync master data in from Dynamics and send awarded Standard Quotes back as projects." />
      <D365Client />
    </>
  );
}
