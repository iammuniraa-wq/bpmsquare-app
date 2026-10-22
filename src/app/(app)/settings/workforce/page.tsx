import { Suspense } from "react";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import WorkforceClient from "./WorkforceClient";
import { loadWorkforceSettings } from "./guard";
import { WORKFORCE_TIPS } from "./tips";

/** Settings > Workforce. Admin only, and only on a workspace that has the Workforce module (see guard.ts). */
export default async function WorkforceSettingsPage() {
  const { config, projectsOn } = await loadWorkforceSettings();
  return (
    <>
      <SettingsPageHeader title="Workforce" info={WORKFORCE_TIPS.page} />
      <Suspense fallback={null}>
        <WorkforceClient initial={config} projectsOn={projectsOn} />
      </Suspense>
    </>
  );
}
