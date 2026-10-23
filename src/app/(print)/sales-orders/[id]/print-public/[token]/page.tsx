import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveCurrency } from "@/lib/currency";
import { getTenantForPublicQuote } from "@/lib/data";
import { orderPublicPdfPath, verifyOrderPublicToken } from "@/lib/salesOrderPublicLink";
import SalesOrderPrint from "@/components/salesOrders/SalesOrderPrint";
import { loadOrderForPrint } from "../../../loadPrintOrder";

export async function generateMetadata({ params }: { params: Promise<{ id: string; token: string }> }): Promise<Metadata> {
  const { id, token } = await params;
  if (!verifyOrderPublicToken(id, token)) return { title: "Sales order" };
  const data = await loadOrderForPrint(id, null);
  return { title: data?.order.ref ?? "Sales order" };
}

// No login: reached by a signed, expiring link (src/lib/salesOrderPublicLink.ts), e.g. from a WhatsApp message. The
// token is checked against the exact order id in the address before anything is read, and every query after the first
// is scoped to that order's own tenant (loadOrderForPrint).
export default async function SalesOrderPublicPrintPage({ params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  if (!verifyOrderPublicToken(id, token)) notFound();
  const data = await loadOrderForPrint(id, null);
  if (!data) notFound();
  const tenant = await getTenantForPublicQuote(data.tenantId);

  return (
    <SalesOrderPrint
      order={data.order}
      lines={data.lines}
      account={data.account}
      contact={data.contact}
      companyInfo={tenant?.company_info ?? {}}
      logoUrl={tenant?.logo_url ?? null}
      template={data.template}
      currency={resolveCurrency(tenant?.config).code}
      pdfHref={orderPublicPdfPath(data.order.id, token)}
    />
  );
}
