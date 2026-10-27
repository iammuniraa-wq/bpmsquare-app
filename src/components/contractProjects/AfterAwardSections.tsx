import type { ProjectRow } from "@/lib/contractProjects/types";
import type { ProjectCtx } from "@/lib/contractProjects/server";
import { buildVariationsData } from "@/lib/contractProjects/variationsServer";
import { buildMilestonesData } from "@/lib/contractProjects/milestonesServer";
import VariationsTab from "./VariationsTab";
import InvoicingTab from "./InvoicingTab";

// The two after-award tabs of a contract project as server components: each loads its own data, and only when its tab is the one open
// (ObjectRecordPage renders the active tab's content only), so a project page that is not on these tabs reads neither table.

export async function VariationsSection({ req, project }: { req: ProjectCtx; project: ProjectRow }) {
  const data = await buildVariationsData(req, project);
  return <VariationsTab projectId={project.id} data={data} />;
}

export async function InvoicingSection({ req, project }: { req: ProjectCtx; project: ProjectRow }) {
  const data = await buildMilestonesData(req, project);
  return <InvoicingTab projectId={project.id} data={data} projectClosed={project.status === "closed"} />;
}
