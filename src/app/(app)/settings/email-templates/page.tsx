import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Email templates is now part of the Templates tab of Quotations; the old address keeps working.
export default function EmailTemplatesRedirect() {
  redirect(OLD_SETTINGS_ROUTES.emailTemplates);
}
