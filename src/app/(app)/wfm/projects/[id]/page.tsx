import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import { projectSiteMap } from "@/lib/wfm/projects";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import NovaTimelineSlot from "@/components/NovaTimelineSlot";
import type { WfmProject } from "@/lib/wfm/types";
import ProjectForm from "../ProjectForm";
import ProjectHoursPanel from "./ProjectHoursPanel";

export default async function WfmProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireFeature("wfm_projects");
  await requireWfmSupervisorPage();

  const { supabase, tenantId } = await requireTenantUser();
  const { id } = await params;

  const { data } = await supabase
    .from("wfm_projects")
    .select("id, ref, name, code, parent_id, account_id, status, start_date, end_date, budget_hours, custom_data")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (!data) notFound();

  const sites = await projectSiteMap(createAdminSupabase(), tenantId, [id]);
  const project = { ...data, site_ids: sites.get(id) ?? [] } as unknown as WfmProject;

  return (
    <>
      <TabTitle title={`Workforce — ${project.name}`} />
      <PageHeader
        title={project.name}
        subtitle={[project.ref, project.code].filter(Boolean).join(" · ") || undefined}
      />

      <ProjectHoursPanel projectId={id} budgetHours={project.budget_hours} />

      <div style={{ marginTop: 20 }}>
        <ProjectForm project={project} />
      </div>

      <NovaTimelineSlot objectType="wfm_projects" objectId={id} />
    </>
  );
}
