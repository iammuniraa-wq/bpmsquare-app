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

export default async function EstimateTemplatesPage() {
  const { supabase, tenantId, role } = await requireTenantUser();
  if (role !== "admin") redirect(ROUTES.settings);
  await requireFeature("estimator");
  await requireWorkcenterView("estimates");
  const { rows, missing } = await listTemplates(supabase, tenantId);

  return (
    <>
      <SettingsPageHeader
        title="Estimate templates"
        subtitle="A template holds the inputs, rates and rule lines an estimate is worked out from. Editing one never re-prices an estimate that already exists."
      />
      {missing ? (
        <Card padding={0}><EmptyState title="Estimates are waiting for a database update" text={PENDING_MESSAGE} /></Card>
      ) : (
        <TemplatesListClient templates={rows} />
      )}
    </>
  );
}
