import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import GalleryClient from "@/components/crew/GalleryClient";
import { ROUTES } from "@/lib/constants";
import { CREW_TIPS } from "@/lib/crew/tips";
import { openCrew } from "@/lib/crew/server/access";
import { loadCrewView } from "@/lib/crew/server/view";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";

// AI automation (docs/design/nova-crew-agents.md, owner decision 2026-11-04): a workcenter whose landing page is a gallery of tiles, one per
// agent. Behind the platform-admin-only flag `crew`; with it off the route redirects and nothing is read.

export default async function AiAutomationPage() {
  await requireWorkcenterView("crew");
  await requireFeature("crew");
  const door = await openCrew();
  if (!door.ok) redirect(ROUTES.dashboard);
  const view = await loadCrewView(door.ctx, null);
  return (
    <>
      <PageHeader title="AI automation" subtitle="Agents that watch your workspace and suggest the next step." info={CREW_TIPS.page} />
      <GalleryClient view={view} />
    </>
  );
}
