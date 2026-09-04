import { notFound } from "next/navigation";
import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import { projectLinks, projectSelect, tolerateMissingLabel } from "@/lib/wfm/projects";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import NovaTimelineSlot from "@/components/NovaTimelineSlot";
import type { WfmProject } from "@/lib/wfm/types";
import ProjectForm from "../ProjectForm";
import ProjectHoursPanel from "./ProjectHoursPanel";
import SubItems from "./SubItems";

export default async function WfmProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireFeature("wfm_projects");
  await requireWfmSupervisorPage();

  const { supabase, tenantId } = await requireTenantUser();
  const { id } = await params;

  const { data } = await tolerateMissingLabel((withLabel) =>
    supabase
      .from("wfm_projects")
      .select(projectSelect(withLabel))
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle()
  );
  if (!data) notFound();

  const links = await projectLinks(createAdminSupabase(), tenantId, id);
  const project = { ...data, ...links } as unknown as WfmProject;

  // A part opens on its own page, so say what it is a part OF -- otherwise
  // "Structural works" gives no clue which project it belongs to.
  let parentLine: string | null = null;
  if (project.parent_id) {
    const { data: parent } = await supabase
      .from("wfm_projects")
      .select("name")
      .eq("id", project.parent_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (parent) parentLine = `${project.level_label?.trim() || "Part"} of ${parent.name}`;
  }

  return (
    <>
      <TabTitle title={`Workforce — ${project.name}`} />
      <PageHeader
        title={project.name}
        subtitle={[parentLine, project.ref, project.code].filter(Boolean).join(" · ") || undefined}
      />

      <ProjectHoursPanel projectId={id} budgetHours={project.budget_hours} />

      <SubItems projectId={id} />

      <div style={{ marginTop: 20 }}>
        <ProjectForm project={project} />
      </div>

      <NovaTimelineSlot objectType="wfm_projects" objectId={id} />
    </>
  );
}
