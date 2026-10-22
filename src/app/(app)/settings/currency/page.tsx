import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Currency is now a field on the Tax and currency tab of Company; the old address keeps working.
export default function CurrencyRedirect() {
  redirect(OLD_SETTINGS_ROUTES.currency);
}
