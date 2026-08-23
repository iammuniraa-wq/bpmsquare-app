import PageHeader from "@/components/PageHeader";
import HistoryClient from "./HistoryClient";

export default function PricingHistoryPage() {
  return (
    <>
      <PageHeader title="History" subtitle="Every version that's gone live, and what was live on any date." />
      <HistoryClient />
    </>
  );
}
