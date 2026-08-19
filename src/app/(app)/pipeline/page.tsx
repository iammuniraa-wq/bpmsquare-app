import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import Placeholder from "@/components/Placeholder";

/**
 * Pipeline is the OPPORTUNITY journey board (Lead → Quoted → Won →
 * Scheduled → In service → Invoiced, PROJECT.md §UX principles) -- the
 * cross-pillar view of a job travelling through the business. The
 * Opportunity object it needs doesn't exist yet, so this stays a
 * placeholder.
 *
 * The Nova Flow Board is NOT that board: it plots quotes by quote status,
 * so it lives on Quotations. It was briefly mounted here by mistake.
 */
export default async function PipelinePage() {
  await requireWorkcenterView("pipeline");
  await requireFeature("pipeline");
  return (
    <Placeholder
      title="Pipeline"
      subtitle="The customer journey · Hosapete"
      blurb="The journey board (Lead → Quoted → Won → Scheduled → In service → Invoiced) is the next major feature. For now, use the Dashboard for an overview, or open Accounts to browse the full hub."
    />
  );
}
