import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// Product categories used to live at /settings/sales, a name from when the
// page held more than the category tree. Old links keep working.
export default function SalesConfigRedirect() {
  redirect(ROUTES.settingsProductCategories);
}
