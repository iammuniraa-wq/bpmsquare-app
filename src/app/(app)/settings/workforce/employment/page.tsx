import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import WorkforceConfigClient from "../WorkforceConfigClient";
import { loadWorkforceSettings } from "../guard";

export default async function WorkforceEmploymentPage() {
  const { config, projectsOn } = await loadWorkforceSettings();
  return (
    <>
      <SettingsPageHeader title="Employment & billing" subtitle="Employment types, and the rates project hours are billed at." />
      <WorkforceConfigClient initial={config} projectsOn={projectsOn} page="employment" />
    </>
  );
}
