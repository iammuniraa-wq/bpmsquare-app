import Link from "next/link";
import { listQuotes, getCaseLinkedQuoteIds } from "@/lib/data";
import { getTenant, requireFeature } from "@/lib/tenant";
import PageHeader from "@/components/PageHeader";
import { ROUTES, DEFAULT_QUOTE_STATUSES, type QuoteStatusDef } from "@/lib/constants";
import { c } from "@/lib/theme";
import { requireWorkcenterView } from "@/lib/permissions";
import QuotationsList from "./QuotationsList";
import FlowBoardSlot from "@/components/FlowBoardSlot";

export default async function QuotationsPage() {
  await requireWorkcenterView("quotations");
  await requireFeature("quotations");
  const [rows, tenant, caseLinkedQuoteIds] = await Promise.all([listQuotes(), getTenant(), getCaseLinkedQuoteIds()]);
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
              background: `var(--modern-accent, ${c.accent})`, color: "#fff", textDecoration: "none",
            }}
          >
            + Create quote
          </Link>
        }
      />
      <FlowBoardSlot
        list={<QuotationsList initialRows={rows} quoteStatuses={quoteStatuses} caseLinkedQuoteIds={caseLinkedQuoteIds} />}
      />
    </>
  );
}
