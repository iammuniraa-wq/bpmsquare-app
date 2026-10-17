import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import KiosksClient from "../KiosksClient";
import { loadWorkforceSettings } from "../guard";

export default async function WorkforceKiosksPage() {
  await loadWorkforceSettings();
  return (
    <>
      <SettingsPageHeader title="Kiosks" subtitle="Door tablets that let enrolled employees punch by face." />
      <KiosksClient />
    </>
  );
}
