import { redirect } from "next/navigation";
import { OLD_SETTINGS_ROUTES } from "@/lib/settingsFolded";

// Asset print fields is now the Print tab of Quotations; the old address keeps working.
export default function AssetPrintFieldsRedirect() {
  redirect(OLD_SETTINGS_ROUTES.assetPrintFields);
}
