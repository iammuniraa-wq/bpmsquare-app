import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Number ranges is now the Numbering tab of Company; the old address keeps working.
export default function NumberRangesRedirect() {
  redirect(OLD_SETTINGS_ROUTES.numberRanges);
}
