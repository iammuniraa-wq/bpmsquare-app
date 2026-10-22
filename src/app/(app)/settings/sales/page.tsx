import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Product categories used to live at /settings/sales, a name from when the
// page held more than the category tree. Old links keep working.
export default function SalesConfigRedirect() {
  redirect(OLD_SETTINGS_ROUTES.productCategories);
}
