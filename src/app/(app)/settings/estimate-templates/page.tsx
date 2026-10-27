import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import { listTemplates, PENDING_MESSAGE } from "@/lib/estimator/server";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import TemplatesListClient from "./TemplatesListClient";

/** Catalogue items still priced from a starter's placeholder cost (products.custom_data.illustrative). A missing products table reads as none. */
async function countIllustrative(supabase: Awaited<ReturnType<typeof requireTenantUser>>["supabase"], tenantId: string): Promise<number> {
  const { count, error } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("custom_data->>illustrative", "true");
  return error ? 0 : count ?? 0;
}

export default async function EstimateTemplatesPage() {
  const { supabase, tenantId, role } = await requireTenantUser();
  if (role !== "admin") redirect(ROUTES.settings);
  await requireFeature("estimator");
  await requireWorkcenterView("estimates");
  const { rows, missing } = await listTemplates(supabase, tenantId);
  const illustrative = missing ? 0 : await countIllustrative(supabase, tenantId);

  return (
    <>
      <SettingsPageHeader
        title="Estimate templates"
        subtitle="A template holds the inputs, rates and rule lines an estimate is worked out from. Editing one never re-prices an estimate that already exists."
      />
      {missing ? (
        <Card padding={0}><EmptyState title="Estimates are waiting for a database update" text={PENDING_MESSAGE} /></Card>
      ) : (
        <TemplatesListClient templates={rows} illustrativeCount={illustrative} />
      )}
    </>
  );
}
