import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import ProjectForm from "../ProjectForm";

export default async function NewWfmProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ parent?: string; label?: string }>;
}) {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireFeature("wfm_projects");
  await requireWfmSupervisorPage();

  // Arriving from a project's "Add <part>" link. The id is passed straight to
  // the form and tenant-verified by the API on save, never trusted here; the
  // label is only a prefill for a text box the user can overwrite.
  const { parent, label } = await searchParams;
  const suggested = (label ?? "").slice(0, 40);

  return (
    <>
      <TabTitle title={parent ? "Workforce — New part" : "Workforce — New project"} />
      <PageHeader
        title={parent ? `New ${suggested || "part"}` : "New project"}
        subtitle={
          parent
            ? "A part of a project collects hours in its own right, and rolls them up into its parent."
            : "A project is what worked hours get attributed to. Its ID is assigned automatically."
        }
      />
      <ProjectForm parentId={parent ?? null} suggestedLabel={suggested} />
    </>
  );
}
