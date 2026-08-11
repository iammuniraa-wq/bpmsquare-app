import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage, getWfmLiveBoardSnapshot } from "@/lib/wfm/server";
import { requireTenantUser, getTenantMembership } from "@/lib/supabase-server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import LiveBoardClient, { type Board } from "./LiveBoardClient";

export default async function WfmLiveBoardPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  // Server-prefetch the board + landing preference so the first paint shows
  // real rows instead of "Loading today's board…" (same treatment as
  // /wfm/me -- see lib/wfm/meState.ts). Client polling stays as-is.
  const { tenantId, userId } = await requireTenantUser();
  const [initialBoard, membership] = await Promise.all([
    // Cast: WfmLiveBoardSnapshot is the same shape with wider string types
    // (employment_type et al are unions on the client side).
    getWfmLiveBoardSnapshot(tenantId).then((b) => b as unknown as Board).catch(() => null),
    getTenantMembership(tenantId, userId).catch(() => null),
  ]);

  return (
    <>
      <TabTitle title="Live board" />
      <PageHeader
        title="Live board"
        subtitle="Who's in, on break, out, late or absent right now — per site, refreshed automatically."
      />
      <LiveBoardClient initialBoard={initialBoard} initialLanding={(membership?.wfm_default_landing as "live_board" | "dashboard" | null) ?? null} />
    </>
  );
}
