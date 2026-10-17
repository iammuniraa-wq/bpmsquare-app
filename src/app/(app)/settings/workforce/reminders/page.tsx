import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import WorkforceConfigClient from "../WorkforceConfigClient";
import { loadWorkforceSettings } from "../guard";

export default async function WorkforceRemindersPage() {
  const { config, projectsOn } = await loadWorkforceSettings();
  return (
    <>
      <SettingsPageHeader title="Reminders & notifications" subtitle="Phone reminders and the emails the workforce module sends." />
      <WorkforceConfigClient initial={config} projectsOn={projectsOn} page="reminders" />
    </>
  );
}
