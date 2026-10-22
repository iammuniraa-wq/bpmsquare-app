import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// Hand-over moved into Settings, Marketing, Leads (its second tab). The old address keeps working.
export default function MarketingHandoverSettingsRedirect() {
  redirect(`${ROUTES.settingsMarketingLeads}?tab=handover`);
}
