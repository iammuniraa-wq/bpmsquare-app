import { requireFeature } from "@/lib/tenant";
import Placeholder from "@/components/Placeholder";

export default async function PipelinePage() {
  await requireFeature("pipeline");
  return (
    <Placeholder
      title="Pipeline"
      subtitle="The customer journey · Hosapete"
      blurb="The journey board (Lead → Quoted → Won → Scheduled → In service → Invoiced) is the next major feature. For now, use the Dashboard for an overview, or open Accounts to browse the full hub."
    />
  );
}
