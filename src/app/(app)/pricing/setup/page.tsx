import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import PageHeader from "@/components/PageHeader";
import PricingSetupClient from "./PricingSetupClient";

export default async function PricingSetupPage() {
  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch {
    redirect("/");
  }
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const canEdit = canEditWorkcenter(perms, "pricing");

  return (
    <>
      <PageHeader
        title="Pricing setup"
        subtitle="Pick how you price, set your numbers, see a sample bill — then go live."
      />
      <PricingSetupClient canEdit={canEdit} />
    </>
  );
}
