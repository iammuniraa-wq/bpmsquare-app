import { requireFeature } from "@/lib/tenant";
import { requireWorkcenterView } from "@/lib/permissions";
import Placeholder from "@/components/Placeholder";

export default async function PartnersPage() {
  await requireWorkcenterView("partners");
  await requireFeature("partners");
  return <Placeholder title="Partners" subtitle="Marketing · OEM referral sources" />;
}
