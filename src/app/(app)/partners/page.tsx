import { requireFeature } from "@/lib/tenant";
import Placeholder from "@/components/Placeholder";

export default async function PartnersPage() {
  await requireFeature("partners");
  return <Placeholder title="Partners" subtitle="Marketing · OEM referral sources" />;
}
