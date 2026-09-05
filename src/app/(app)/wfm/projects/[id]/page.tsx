import { notFound } from "next/navigation";
import { requireFeature, getUserRole, tenantHasFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import { projectLinks, fetchProject } from "@/lib/wfm/projects";
import ProjectBilling from "./ProjectBilling";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import NovaTimelineSlot from "@/components/NovaTimelineSlot";
import type { WfmProject } from "@/lib/wfm/types";
import ProjectForm from "../ProjectForm";
import ProjectHoursPanel from "./ProjectHoursPanel";
import SubItems from "./SubItems";
import { depthOf } from "@/lib/wfm/projectTree";
import DeleteProject from "./DeleteProject";
import ObjectSections from "@/components/fields/ObjectSections";

export default async function WfmProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireFeature("wfm_projects");
  await requireWfmSupervisorPage();

  const { supabase, tenantId } = await requireTenantUser();
  const { id } = await params;

  const { data } = await fetchProject(supabase, tenantId, id);
  if (!data) notFound();

  const admin = createAdminSupabase();
  const [links, role, invoicesOn] = await Promise.all([
    projectLinks(admin, tenantId, id),
    getUserRole(),
    tenantHasFeature(admin, tenantId, "invoices"),
  ]);
  const project = { ...data, ...links } as unknown as WfmProject;

  // A sub-project opens on its own page, so say where it sits -- otherwise
  // "Structural works" gives no clue which project it belongs to. The level
  // is its depth, counted by walking parents.
  let parentLine: string | null = null;
  if (project.parent_id) {
    const { data: all } = await supabase
      .from("wfm_projects").select("id, parent_id, name").eq("tenant_id", tenantId);
    const nodes = new Map((all ?? []).map((p) => [p.id as string, { id: p.id as string, parent_id: (p.parent_id as string | null) ?? null }]));
    const parent = (all ?? []).find((p) => p.id === project.parent_id);
    const level = depthOf(nodes, id);
    if (parent) parentLine = `Level ${level ?? 1} · under ${parent.name}`;
  }

  let accountLine: string | null = null;
  if (project.account_id) {
    const { data: acct } = await supabase
      .from("accounts").select("name").eq("id", project.account_id).eq("tenant_id", tenantId).maybeSingle();
    if (acct) accountLine = `for ${acct.name}`;
  }

  return (
    <>
      <TabTitle title={`Workforce — ${project.name}`} />
      <PageHeader
        title={project.name}
        subtitle={[parentLine, accountLine, project.ref, project.code].filter(Boolean).join(" · ") || undefined}
      />

      <ProjectHoursPanel projectId={id} budgetHours={project.budget_hours} />

      <SubItems projectId={id} />

      {invoicesOn && (
        <ProjectBilling
          projectId={id}
          projectName={project.name}
          accountId={project.account_id}
          isAdmin={role === "admin"}
        />
      )}

      {/* Tenant custom fields (Settings -> Custom fields -> Project). The
          standard fields are hand-rendered by ProjectForm below, so only the
          cf_ ones show here. */}
      <div style={{ marginTop: 16, maxWidth: 760 }}>
        <ObjectSections
          objectType="project"
          record={project as unknown as Record<string, unknown>}
          patchUrl={`/api/wfm/projects/${id}`}
          exclude={["ref", "name", "code", "status", "start_date", "end_date", "budget_hours", "bill_rate"]}
        />
      </div>

      <div style={{ marginTop: 20 }}>
        <ProjectForm project={project} />
        <div style={{ maxWidth: 760 }}>
          <DeleteProject projectId={id} name={project.name} parentId={project.parent_id} />
        </div>
      </div>

      <NovaTimelineSlot objectType="wfm_projects" objectId={id} />
    </>
  );
}
