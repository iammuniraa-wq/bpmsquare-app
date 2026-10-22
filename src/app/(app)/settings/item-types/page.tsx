import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Item types is now the Item types tab of Products; the old address keeps working.
export default function ItemTypesRedirect() {
  redirect(OLD_SETTINGS_ROUTES.itemTypes);
}
