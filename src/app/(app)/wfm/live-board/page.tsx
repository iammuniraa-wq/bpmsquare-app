import { requireWorkcenterView } from "@/lib/permissions";
import { requireFeature } from "@/lib/tenant";
import { requireWfmSupervisorPage } from "@/lib/wfm/server";
import PageHeader from "@/components/PageHeader";
import TabTitle from "@/components/TabTitle";
import LiveBoardClient from "./LiveBoardClient";

export default async function WfmLiveBoardPage() {
  await requireWorkcenterView("wfm");
  await requireFeature("wfm");
  await requireWfmSupervisorPage();

  return (
    <>
      <TabTitle title="Live board" />
      <PageHeader
        title="Live board"
        subtitle="Who's in, on break, out, late or absent right now — per site, refreshed automatically."
      />
      <LiveBoardClient />
    </>
  );
}
