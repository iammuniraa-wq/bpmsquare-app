import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Navigation visibility is now the Menu tab of Appearance; the old address keeps working.
export default function NavigationRedirect() {
  redirect(OLD_SETTINGS_ROUTES.navigation);
}
