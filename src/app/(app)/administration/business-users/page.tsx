import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import BusinessUsersClient from "./BusinessUsersClient";

export default async function BusinessUsersPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.dashboard);
  }
  if (role !== "admin") redirect(ROUTES.dashboard);
  await requireFeature("business_roles");

  return (
    <>
      <TabTitle title="Business Users" />
      <PageHeader
        title="Business Users"
        subtitle="Start from an employee, create their login with an initial password, then control validity, lock, licensing, and Business Roles — all in one place."
      />
      <BusinessUsersClient />
    </>
  );
}
