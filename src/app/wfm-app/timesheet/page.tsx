import { redirect } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import TimesheetClient from "./TimesheetClient";

export default async function WfmTimesheetPage() {
  const tenant = await getTenant();
  if (!tenant?.features?.wfm) redirect("/");
  return <TimesheetClient accentColor={tenant.accent_color ?? "#378ADD"} />;
}
