import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Entities & Tax is now the Entities tab of Company; the old address keeps working.
export default function EntitiesRedirect() {
  redirect(OLD_SETTINGS_ROUTES.entities);
}
