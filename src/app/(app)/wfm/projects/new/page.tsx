import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import ProjectForm from "../ProjectForm";

export default async function NewWfmProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ parent?: string; account?: string }>;
}) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireFeature("wfm_projects");
  await requireWfmSupervisorPage();

  // Arriving from a project's "Create sub-project" button. The id is passed
  // straight to the form and tenant-verified by the API on save, never
  // trusted here -- it only preselects a row in the "Sits under" picker.
  const { parent, account } = await searchParams;

  return (
    <>
      <TabTitle title={parent ? "Workforce — New sub-project" : "Workforce — New project"} />
      <PageHeader
        title={parent ? "New sub-project" : "New project"}
        subtitle={
          parent
            ? "A sub-project has everything a project has — people, shifts, sites, dates and a budget. Its hours roll up into the project above it."
            : "A project is what worked hours get attributed to. Its ID is assigned automatically."
        }
      />
      {/* Keyed by the parent, so "Save & add sub-project" gets a FRESH form.
          It navigates from /new to /new?parent=… -- the same route, so React
          reuses the component and useState initialisers never re-run; without
          this the child form opened holding the project's own dates, budget
          and an empty "Sits under" that rendered as Level 0. */}
      <ProjectForm key={parent ?? "top"} parentId={parent ?? null} accountId={account ?? null} />
    </>
  );
}
