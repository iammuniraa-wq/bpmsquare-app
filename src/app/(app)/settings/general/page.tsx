import { redirect } from "next/navigation";
import { ROUTES } from "@/lib/constants";

// General settings was split into one page per section (company, navigation,
// appearance, developer, ...). The old address keeps working and lands on the
// first of them.
export default function GeneralSettingsRedirect() {
  redirect(ROUTES.settingsCompany);
}
