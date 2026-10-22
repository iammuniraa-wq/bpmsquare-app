import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Reset layout is now a link on the Menu tab of Appearance; the old address keeps working.
export default function ResetRedirect() {
  redirect(OLD_SETTINGS_ROUTES.reset);
}
