import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// Workforce settings used to be one page with five tabs. It is now eight
// pages (see lib/settingsMenu.ts); the old address lands on the first.
export default function SettingsWorkforceRedirect() {
  redirect(ROUTES.settingsWorkforceAttendance);
}
