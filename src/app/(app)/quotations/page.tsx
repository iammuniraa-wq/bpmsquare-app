import Link from "next/link";
import { listQuotes } from "@/lib/data";
import { getTenant } from "@/lib/tenant";
import PageHeader from "@/components/PageHeader";
import { ROUTES, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { c } from "@/lib/theme";
import QuotationsList from "./QuotationsList";

export default async function QuotationsPage() {
  const [rows, tenant] = await Promise.all([listQuotes(), getTenant()]);
  const quoteStatuses: QuoteStatusDef[] =
    (tenant?.config as { quote_statuses?: QuoteStatusDef[] })?.quote_statuses ?? DEFAULT_QUOTE_STATUSES;
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
      <QuotationsList initialRows={rows} quoteStatuses={quoteStatuses} />
    </>
  );
}
