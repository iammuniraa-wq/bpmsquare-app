import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfm } from "@/lib/wfm/server";
import { buildWfmMeState } from "@/lib/wfm/meState";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import MeClient from "../MeClient";

// My Details -- everything about the employee that ISN'T punching: Time,
// Requests, Calendar, Timeline and Profile.
//
// Split out of /wfm/me on 2026-10-03. That screen is the landing page for
// every role in a WFM workspace, and it eagerly fetched all seven tabs'
// data on arrival -- for a page most people open to press one button and
// leave. The punch screen now loads its own state and nothing else; each
// tab here fetches when it is opened.
//
// Routed UNDER /wfm/me deliberately: (app)/layout.tsx confines a WFM-only
// employee to the punch screen's path prefix, so a sibling route would have
// bounced them straight back out of their own timesheet.
export default async function WfmMyDetailsPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");

  // Same server-side bootstrap as the punch screen: the /state payload backs
  // the profile header and the punch-state checks the tabs still reference.
  let initialState = null;
  try {
    const ctx = await requireWfm();
    const state = await buildWfmMeState(ctx);
    if (state.employee) initialState = state;
  } catch {
    // no linked employee -- the client load handles the empty case
  }

  return (
    <>
      <TabTitle title="My Details" />
      <PageHeader
        title="My Details"
        subtitle="Your hours, requests, calendar and profile."
      />
      <MeClient initialState={initialState} view="details" />
    </>
  );
}
