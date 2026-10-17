import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import SitesClient from "../SitesClient";
import { loadWorkforceSettings } from "../guard";

export default async function WorkforceSitesPage() {
  await loadWorkforceSettings();
  return (
    <>
      <SettingsPageHeader title="Sites" subtitle="The places people punch in at, their geofence and who approves their requests." />
      <SitesClient canEdit={true} />
    </>
  );
}
