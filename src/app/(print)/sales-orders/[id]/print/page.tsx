import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant, getTenantCurrency } from "@/lib/tenant";
import SalesOrderPrint from "@/components/salesOrders/SalesOrderPrint";
import { loadOrderForPrint } from "../../loadPrintOrder";

// The page <title> is what a browser's print / Save-as-PDF dialog suggests as the filename.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const { tenantId } = await requireTenantUser();
    const data = await loadOrderForPrint(id, tenantId);
    return { title: data?.order.ref ?? "Sales order" };
  } catch {
    return { title: "Sales order" };
  }
}

/**
 * The order on paper for a signed-in member: the order TYPE's template blocks, each line's printed text under the line,
 * the tenant's letterhead. The PDF route renders this same page.
 */
export default async function SalesOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let tenantId: string;
  try {
    ({ tenantId } = await requireTenantUser());
  } catch {
    notFound();
  }
  const [data, tenant, currency] = await Promise.all([loadOrderForPrint(id, tenantId), getTenant(), getTenantCurrency()]);
  if (!data || !tenant?.features?.sales_orders) notFound();

  return (
    <SalesOrderPrint
      order={data.order}
      lines={data.lines}
      account={data.account}
      contact={data.contact}
      companyInfo={tenant.company_info ?? {}}
      logoUrl={tenant.logo_url ?? null}
      template={data.template}
      currency={currency.code}
      pdfHref={`/api/sales-orders/${data.order.id}/pdf`}
    />
  );
}
