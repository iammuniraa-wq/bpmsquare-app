import Link from "next/link";
import { ROUTES } from "@/lib/constants";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import CreateSalesOrderButton from "./CreateSalesOrderButton";
import { findOrderForSource } from "./serverData";
import s from "./salesOrders.module.css";

/**
 * The Quotation page's sales-order strip: the order made from this quotation as a fact, or the "Create sales order"
 * button once it is won. Renders nothing at all unless the workspace has Sales Orders, so every other workspace sees
 * exactly the page it had.
 */
export default async function QuoteSalesOrder({ sourceType, sourceId, ready }: { sourceType: "quotation" | "standard_quote"; sourceId: string; ready: boolean }) {
  const tenant = await getTenant();
  if (tenant?.features?.sales_orders !== true) return null;
  let existing: { id: string; ref: string } | null = null;
  try {
    const { supabase, tenantId } = await requireTenantUser();
    existing = await findOrderForSource(supabase, tenantId, sourceType, sourceId);
  } catch {
    return null;
  }
  if (!existing && !ready) return null;
  return (
    <div className={s.chips} style={{ margin: "0 0 12px" }} data-guide="quote.sales_order">
      {existing ? (
        <span className="bpm-t-help">
          Sales order{" "}
          <Link href={ROUTES.salesOrder(existing.id)} style={{ color: "var(--tab-accent, var(--accent))", fontWeight: 700, textDecoration: "none" }}>{existing.ref}</Link>
        </span>
      ) : (
        <CreateSalesOrderButton sourceType={sourceType} sourceId={sourceId} />
      )}
    </div>
  );
}
