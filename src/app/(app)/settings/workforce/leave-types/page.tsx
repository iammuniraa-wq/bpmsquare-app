import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Batch S5: this page is now a tab of Settings > Workforce.
export default function WorkforceLeaveTypesRedirect() {
  redirect(OLD_SETTINGS_ROUTES.workforceLeaveTypes);
}
