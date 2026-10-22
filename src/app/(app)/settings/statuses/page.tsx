import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Quote statuses is now the Statuses tab of Quotations; the old address keeps working.
export default function StatusesRedirect() {
  redirect(OLD_SETTINGS_ROUTES.statuses);
}
