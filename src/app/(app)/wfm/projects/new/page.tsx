import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import ProjectForm from "../ProjectForm";

export default async function NewWfmProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ parent?: string }>;
}) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireFeature("wfm_projects");
  await requireWfmSupervisorPage();

  // Arriving from a project's "Add <level>" link. The id is passed straight
  // to the form and tenant-verified by the API on save, never trusted here.
  const { parent } = await searchParams;

  return (
    <>
      <TabTitle title="Workforce — New project" />
      <PageHeader
        title="New project"
        subtitle="A project is what worked hours get attributed to. Its ID is assigned automatically."
      />
      <ProjectForm parentId={parent ?? null} />
    </>
  );
}
