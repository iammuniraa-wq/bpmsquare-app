import { listPricingItems } from "@/lib/data";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import PricingClient from "./PricingClient";

export default async function PricingConfigPage() {
  const items = await listPricingItems();
  return (
    <>
      <SettingsPageHeader title="Small Scale Pricing" subtitle="Static standard rates for labour, materials, testing and transport — the simple pricing model for small tenants" />
      <PricingClient initialItems={items} />
    </>
  );
}
