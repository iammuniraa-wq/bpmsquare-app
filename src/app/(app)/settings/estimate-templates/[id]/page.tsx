import { notFound, redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import { PENDING_MESSAGE, loadTemplate, templateUsage } from "@/lib/estimator/server";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import TemplateEditor from "./TemplateEditor";

export default async function EstimateTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, tenantId, role } = await requireTenantUser();
  if (role !== "admin") redirect(ROUTES.settings);
  await requireFeature("estimator");
  await requireWorkcenterView("estimates");
  const { id } = await params;

  const t = await loadTemplate(supabase, tenantId, id);
  if (t.missing) {
    return (
      <>
        <SettingsPageHeader title="Estimate template" />
        <Card padding={0}><EmptyState title="Estimates are waiting for a database update" text={PENDING_MESSAGE} /></Card>
      </>
    );
  }
  if (!t.data) notFound();
  const usage = await templateUsage(supabase, tenantId, [id]);

  return (
    <>
      <SettingsPageHeader
        title={t.data.name}
        subtitle="Changing inputs, rates or rules makes a new version. Estimates already made keep the numbers they were calculated with."
      />
      <TemplateEditor key={`${t.data.id}:${t.data.version}`} template={t.data} estimateCount={usage.get(id) ?? 0} />
    </>
  );
}
