import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature, getTenant } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import BusinessRolesClient from "./BusinessRolesClient";

export default async function BusinessRolesPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.dashboard);
  }
  if (role !== "admin") redirect(ROUTES.dashboard);
  await requireFeature("business_roles");

  const tenant = await getTenant();

  return (
    <>
      <TabTitle title="Business Roles" />
      <PageHeader
        title="Business Roles"
        subtitle="Define named roles, grant them access to specific workcenters, then assign roles to team members in Settings → Team. A member with no role assigned keeps full access, unchanged — assigning a role is how you narrow what they can reach."
      />
      <BusinessRolesClient features={tenant?.features ?? ({} as never)} />
    </>
  );
}
