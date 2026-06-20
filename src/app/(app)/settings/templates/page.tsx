import { listTextFragments } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import TemplatesClient from "./TemplatesClient";

export default async function QuoteConfigPage() {
  const fragments = await listTextFragments();
  return (
    <>
      <PageHeader title="Text templates" subtitle="Saved snippets for line items, notes and terms — insert with one click when creating quotes" />
      <TemplatesClient initialFragments={fragments} />
    </>
  );
}
