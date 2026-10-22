import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Text templates is now part of the Templates tab of Quotations; the old address keeps working.
export default function TextTemplatesRedirect() {
  redirect(OLD_SETTINGS_ROUTES.textTemplates);
}
