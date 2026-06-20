import { listQuotes } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import ReportsClient from "./ReportsClient";

export default async function ReportsPage() {
  const rows = await listQuotes();
  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="Data · Reports · Export"
      />
      <ReportsClient rows={rows} />
    </>
  );
}
