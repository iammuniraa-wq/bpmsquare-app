import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTenant } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";
import { loadOrderPrintData } from "@/lib/salesOrders/printData";
import SalesOrderPrint from "@/components/SalesOrderPrint";

// The printed sales order for a signed-in person. The page <title> is what a browser's print / Save as PDF dialog
// suggests as the file name, so it is the order's ref. The tenant is the viewer's own workspace and the module flag
// must be on; the order is read with that tenant id, so another workspace's order id simply is not found.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const tenant = await getTenant();
  if (!tenant?.features?.sales_orders) return { title: "Sales order" };
  const { data } = await createAdminSupabase().from("sales_orders").select("ref").eq("id", id).eq("tenant_id", tenant.id).maybeSingle();
  return { title: (data as { ref?: string } | null)?.ref || "Sales order" };
}

export default async function SalesOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getTenant();
  if (!tenant?.features?.sales_orders) notFound();
  const data = await loadOrderPrintData(createAdminSupabase(), tenant.id, id);
  if (!data) notFound();

  return (
    <SalesOrderPrint
      pdfHref={`/api/sales-orders/${id}/pdf`}
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
