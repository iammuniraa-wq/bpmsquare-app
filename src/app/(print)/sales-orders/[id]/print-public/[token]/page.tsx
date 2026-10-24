import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase-server";
import { getTenantForPublicQuote } from "@/lib/data";
import { verifyOrderPublicToken } from "@/lib/salesOrderPublicLink";
import { loadOrderPrintData, tenantOfOrder } from "@/lib/salesOrders/printData";
import SalesOrderPrint from "@/components/SalesOrderPrint";

// No login: reached through a signed, expiring link (lib/salesOrderPublicLink.ts), for example from a WhatsApp message.
// The token is verified against the exact order id in the URL BEFORE anything is read; the tenant is then the order's
// own, and the workspace must still own the Sales Orders module. Every query after that is tenant-scoped.
async function load(id: string, token: string) {
  if (!verifyOrderPublicToken(id, token)) return null;
  const admin = createAdminSupabase();
  const tenantId = await tenantOfOrder(admin, id);
  if (!tenantId) return null;
  const tenant = await getTenantForPublicQuote(tenantId);
  if (!tenant) return null;
  const { data: feat } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
  if (!(feat?.features as { sales_orders?: boolean } | undefined)?.sales_orders) return null;
  const data = await loadOrderPrintData(admin, tenantId, id);
  return data ? { data, tenant } : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string; token: string }> }): Promise<Metadata> {
  const { id, token } = await params;
  const r = await load(id, token);
  return { title: r?.data.order.ref || "Sales order" };
}

export default async function SalesOrderPublicPrintPage({ params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params;
  const r = await load(id, token);
  if (!r) notFound();
  const { data, tenant } = r;

  return (
    <SalesOrderPrint
      pdfHref={`/api/sales-orders/${id}/pdf-public/${token}`}
      order={data.order}
      lines={data.lines}
      account={data.account}
      contact={data.contact}
      companyInfo={tenant.company_info ?? {}}
      logoUrl={tenant.logo_url ?? null}
      blocks={data.blocks}
      accent={data.accent}
      logoPosition={data.logoPosition}
      fallbackCurrency={tenant.config?.currency ?? undefined}
    />
  );
}
