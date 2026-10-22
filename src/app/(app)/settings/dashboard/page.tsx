import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Dashboard content is now the Dashboard tab of Appearance; the old address keeps working.
export default function DashboardRedirect() {
  redirect(OLD_SETTINGS_ROUTES.dashboard);
}
