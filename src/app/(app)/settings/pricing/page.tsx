import { listPricingItems } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import PricingClient from "./PricingClient";

export default async function PricingConfigPage() {
  const items = await listPricingItems();
  return (
    <>
      <PageHeader title="Pricing catalogue" subtitle="Standard rates for labour, materials, testing and transport" />
      <PricingClient initialItems={items} />
    </>
  );
}
