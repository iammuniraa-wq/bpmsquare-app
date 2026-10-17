import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import WorkforceConfigClient from "../WorkforceConfigClient";
import { loadWorkforceSettings } from "../guard";

export default async function WorkforceAttendancePage() {
  const { config, projectsOn } = await loadWorkforceSettings();
  return (
    <>
      <SettingsPageHeader title="Attendance rules" subtitle="Timezone, how hours are counted, weekly off days and alternate Saturdays." />
      <WorkforceConfigClient initial={config} projectsOn={projectsOn} page="attendance" />
    </>
  );
}
