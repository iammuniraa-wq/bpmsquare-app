import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Quote types is now the Offer types tab of Quotations; the old address keeps working.
export default function QuoteTypesRedirect() {
  redirect(OLD_SETTINGS_ROUTES.quoteTypes);
}
