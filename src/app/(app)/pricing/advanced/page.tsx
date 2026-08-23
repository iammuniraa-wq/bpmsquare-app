import PageHeader from "@/components/PageHeader";
import PricingEngineClient from "./PricingEngineClient";

export default function PricingAdvancedPage() {
  return (
    <>
      <PageHeader
        title="Advanced"
        subtitle="Raw versioned configuration: dimensions, components, procedures, rules, cost models — for when the wizard isn't enough"
      />
      <PricingEngineClient />
    </>
  );
}
