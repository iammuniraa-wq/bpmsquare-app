import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// Scoring moved into Settings, Marketing, Leads (its first tab). The old address keeps working.
export default function MarketingScoringSettingsRedirect() {
  redirect(ROUTES.settingsMarketingLeads);
}
