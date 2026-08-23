import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView, resolvePermissions, canEditWorkcenter } from "@/lib/permissions";
import PricingShell from "./PricingShell";

export default async function PricingLayout({ children }: { children: React.ReactNode }) {
  await requireWorkcenterView("pricing");
  await requireFeature("pricing_engine");

  let supabase, tenantId, userId, role;
  try {
    ({ supabase, tenantId, userId, role } = await requireTenantUser());
  } catch {
    redirect("/");
  }
  const perms = await resolvePermissions(supabase, tenantId, userId, role);
  const canEdit = canEditWorkcenter(perms, "pricing");

  return <PricingShell canEdit={canEdit}>{children}</PricingShell>;
}
