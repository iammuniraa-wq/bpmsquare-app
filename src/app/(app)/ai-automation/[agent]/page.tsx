import { notFound, redirect } from "next/navigation";
import AgentClient from "@/components/crew/AgentClient";
import { ROUTES } from "@/lib/constants";
import { canSeeFinding } from "@/lib/crew/core/visibility";
import { openCrew, viewerOf } from "@/lib/crew/server/access";
import { loadSettings } from "@/lib/crew/server/store";
import { loadCrewView } from "@/lib/crew/server/view";
import { isAgentKey } from "@/lib/crew/registry";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";

// One agent's page: Review, Runs, Settings. An agent the workspace does not have is a 404, like any other module that is off.

export default async function AgentPage({ params }: { params: Promise<{ agent: string }> }) {
  const { agent } = await params;
  await requireWorkcenterView("crew");
  await requireFeature("crew");
  if (!isAgentKey(agent)) notFound();
  const door = await openCrew(agent);
  if (!door.ok) {
    if (door.res.status === 404) notFound();
    redirect(ROUTES.dashboard);
  }
  const { ctx, entry } = door;
  const view = await loadCrewView(ctx, agent);
  const settings = await loadSettings(ctx.admin, ctx.tenantId);
  const canDigest = canSeeFinding(viewerOf(ctx), { agent_key: agent, recipient_ids: [ctx.userId] }, settings.get(agent).config.visibility);
  return <AgentClient entry={entry!} view={view} canDigest={canDigest} />;
}
