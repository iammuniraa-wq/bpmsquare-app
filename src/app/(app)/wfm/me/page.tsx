import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfm } from "@/lib/wfm/server";
import { buildWfmMeState } from "@/lib/wfm/meState";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import MeClient from "./MeClient";

// The unified WFM home for any linked employee -- a tile dashboard (Home,
// Time, Leave, Calendar, Analytics) inside the normal CRM shell, with
// check in/out happening straight from the Punch tile rather than on a
// dedicated screen. Replaces the old standalone /wfm-app as the primary
// experience; every WFM login (employee or supervisor) lands here.
export default async function WfmMePage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");

  // Compute the punch screen's bootstrap during THIS render so the first
  // paint shows real data -- previously MeClient fetched /api/wfm/me/state
  // only after the client bundle compiled, which DevTools measured as a
  // ~2s LCP render delay. Falls back to the client-side fetch (null) on
  // any error, so this can never make the page less available than before.
  let initialState = null;
  try {
    const ctx = await requireWfm();
    const state = await buildWfmMeState(ctx);
    if (state.employee) initialState = state;
  } catch {
    // e.g. no linked employee context edge cases -- client load handles it
  }

  return (
    <>
      <TabTitle title="My Workforce" />
      <PageHeader
        title="My Workforce"
        subtitle="Punch in and out, track your hours, request leave, and see how you're doing."
      />
      <MeClient initialState={initialState} />
    </>
  );
}
