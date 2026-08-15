import { listPricingItems } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import PricingClient from "./PricingClient";

export default async function PricingConfigPage() {
  const items = await listPricingItems();
  return (
    <>
      <PageHeader title="Small Scale Pricing" subtitle="Static standard rates for labour, materials, testing and transport — the simple pricing model for small tenants" />
      <PricingClient initialItems={items} />
    </>
  );
}
