import { redirect } from "next/navigation";
import { tabHref } from "@/lib/settingsFolded";
import { ROUTES } from "@/lib/constants";

// The layouts list moved into Settings > PDF documents (docs/design/pdf-design-system.md, 4.4): one place per setting. The old
// address keeps working, and the layout builder below it (/standard-quotes/templates/[id]) is unchanged.
export default function StandardQuoteTemplatesRedirect() {
  redirect(tabHref(ROUTES.settingsPdfDocuments, "layouts", "frame"));
}
