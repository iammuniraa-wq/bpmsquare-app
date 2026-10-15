import Link from "next/link";
import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import PageHeader from "@/components/PageHeader";
import D365Client from "./D365Client";

export default async function Dynamics365Page() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  return (
    <>
      <div style={{ marginBottom: 8 }}>
        <Link href={ROUTES.settingsConnectors} style={{ fontSize: 11.5, color: c.muted, textDecoration: "none" }}>← Connectors</Link>
      </div>
      <PageHeader title="Microsoft Dynamics 365" subtitle="Sync master data in from Dynamics and send won fence projects back as projects." />
      <D365Client />
    </>
  );
}
