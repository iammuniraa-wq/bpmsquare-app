import { notFound } from "next/navigation";
import { getTenant, requireFeature } from "@/lib/tenant";
import { requireTenantUser } from "@/lib/supabase-server";
import { resolvePermissions, requireWorkcenterView, canEditWorkcenter } from "@/lib/permissions";
import PageHeader from "@/components/PageHeader";
import ReportsTabs from "../ReportsTabs";
import AskPanel from "../AskPanel";

export default async function TalkToDataPage() {
  await requireWorkcenterView("reports");
  await requireFeature("reports");

  const { supabase, tenantId, userId, role } = await requireTenantUser();
  const [tenant, perms] = await Promise.all([
    getTenant(),
    resolvePermissions(supabase, tenantId, userId, role),
  ]);
  // Separately sold module -- a tenant without it gets a 404, not an inert page.
  if (tenant?.features?.ai_reports !== true) notFound();

  return (
    <>
      <PageHeader title="Analytics" subtitle="Talk to data — ask anything, get a live report" />
      <ReportsTabs showTalk />
      <AskPanel canSave={canEditWorkcenter(perms, "reports")} fullPage />
    </>
  );
}
