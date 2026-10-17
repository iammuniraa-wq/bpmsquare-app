import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import LeaveTypesClient from "../LeaveTypesClient";
import { loadWorkforceSettings } from "../guard";

export default async function WorkforceLeaveTypesPage() {
  await loadWorkforceSettings();
  return (
    <>
      <SettingsPageHeader title="Leave types" subtitle="What people can request time off as, and the quota for each." />
      <LeaveTypesClient />
    </>
  );
}
