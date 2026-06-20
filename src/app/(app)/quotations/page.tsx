import Link from "next/link";
import { listQuotes } from "@/lib/data";
import PageHeader from "@/components/PageHeader";
import { ROUTES } from "@/lib/constants";
import { c } from "@/lib/theme";
import QuotationsList from "./QuotationsList";

export default async function QuotationsPage() {
  const rows = await listQuotes();
  return (
    <>
      <PageHeader
        title="Quotations"
        subtitle={`Sales · ${rows.length} quotes`}
        action={
          <Link
            href={ROUTES.quotationNew}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
              background: c.accent, color: "#fff", textDecoration: "none",
            }}
          >
            + Create quote
          </Link>
        }
      />
      <QuotationsList initialRows={rows} />
    </>
  );
}
