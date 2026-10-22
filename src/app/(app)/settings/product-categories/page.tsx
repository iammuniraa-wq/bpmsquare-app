import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Product categories is now the Categories tab of Products; the old address keeps working.
export default function ProductCategoriesRedirect() {
  redirect(OLD_SETTINGS_ROUTES.productCategories);
}
