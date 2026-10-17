import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import ShiftsClient from "../ShiftsClient";
import { loadWorkforceSettings } from "../guard";

export default async function WorkforceShiftsPage() {
  await loadWorkforceSettings();
  return (
    <>
      <SettingsPageHeader title="Shifts" subtitle="Working hours people are expected to keep, and how late counts as late." />
      <ShiftsClient canEdit={true} />
    </>
  );
}
