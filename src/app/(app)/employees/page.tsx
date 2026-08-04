import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import type { Employee } from "@/lib/types";
import EmployeesClient from "./EmployeesClient";

export default async function EmployeesPage() {
  await requireWorkcenterView("employees");
  await requireFeature("business_roles");
  const { supabase, tenantId, role } = await requireTenantUser();

  const { data } = await supabase
    .from("employees")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("last_name")
    .order("first_name");

  return (
    <>
      <TabTitle title="Employees" />
      <PageHeader
        title="Employees"
        subtitle="Your people as master data — create them here or bulk-load from an HR export via Data Workbench, then give one a login in Administrator → Business Users."
      />
      <EmployeesClient employees={(data ?? []) as Employee[]} canEdit={role === "admin"} />
    </>
  );
}
