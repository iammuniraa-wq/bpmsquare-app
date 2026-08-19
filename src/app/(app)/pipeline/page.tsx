import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import Placeholder from "@/components/Placeholder";
import FlowBoardSlot from "@/components/FlowBoardSlot";

export default async function PipelinePage() {
  await requireWorkcenterView("pipeline");
  await requireFeature("pipeline");

  return (
    <>
      <FlowBoardSlot
        fallback={
          <Placeholder
            title="Pipeline"
            subtitle="The customer journey · Hosapete"
            blurb="The journey board (Lead → Quoted → Won → Scheduled → In service → Invoiced) is the next major feature. For now, use the Dashboard for an overview, or open Accounts to browse the full hub."
          />
        }
      />
    </>
  );
}
