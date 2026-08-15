import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { requireTenantUser } from "@/lib/supabase-server";
import { tenantHasFeature } from "@/lib/tenant";
import PricingEngineClient from "./PricingEngineClient";

export default async function PricingEnginePage() {
  const { supabase, tenantId, role } = await requireTenantUser();
  if (role !== "admin") redirect("/settings");
  if (!(await tenantHasFeature(supabase, tenantId, "pricing_engine"))) redirect("/settings");

  return (
    <>
      <PageHeader
        title="Pricing Engine"
        subtitle="Dynamic pricing: versioned configuration, cost models, rules and the explainable price waterfall"
      />
      <PricingEngineClient />
    </>
  );
}
