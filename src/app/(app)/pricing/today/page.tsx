import PageHeader from "@/components/PageHeader";
import TodaysRatesClient from "./TodaysRatesClient";

export default function TodaysRatesPage() {
  return (
    <>
      <PageHeader title="Today's rates" subtitle="What's live right now, in plain language." />
      <TodaysRatesClient />
    </>
  );
}
