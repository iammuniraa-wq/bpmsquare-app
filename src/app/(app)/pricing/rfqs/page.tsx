import PageHeader from "@/components/PageHeader";
import RfqsClient from "./RfqsClient";

export default function PricingRfqsPage() {
  return (
    <>
      <PageHeader title="RFQs" subtitle="Where the engine had no cost on file and asked a supplier. Enter the reply and the next Fetch price uses it." />
      <RfqsClient />
    </>
  );
}
