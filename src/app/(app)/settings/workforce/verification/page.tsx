import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import WorkforceConfigClient from "../WorkforceConfigClient";
import { loadWorkforceSettings } from "../guard";

export default async function WorkforceVerificationPage() {
  const { config, projectsOn } = await loadWorkforceSettings();
  return (
    <>
      <SettingsPageHeader title="Punching & verification" subtitle="Which punch types exist, and how a punch is verified and located." />
      <WorkforceConfigClient initial={config} projectsOn={projectsOn} page="verification" />
    </>
  );
}
