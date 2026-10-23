import { Suspense } from "react";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant, getTenantCurrency, requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import SalesOrderDetail from "@/components/salesOrders/SalesOrderDetail";
import { orderCustomerPhone } from "@/components/salesOrders/serverData";
import { standardQuoteProducts } from "../../standard-quotes/formData";

/**
 * Sales order record page. The page only gates (workcenter, module flag) and hands over what the server knows best: the
 * catalog for the line editor, the ERP id line, the tenant's currency. The order itself loads from /api/sales-orders so
 * a failed or missing endpoint renders an empty state, not an error page.
 */
export default async function SalesOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireWorkcenterView("sales_orders");
  await requireFeature("sales_orders");
  const { id } = await params;
  const [{ supabase, tenantId, role }, tenant] = await Promise.all([requireTenantUser(), getTenant()]);
  const [products, currency, whatsappPhone] = await Promise.all([standardQuoteProducts(supabase, tenantId, tenant), getTenantCurrency(), orderCustomerPhone(supabase, tenantId, id)]);
  const isAdmin = role === "admin";

  return (
    <Suspense fallback={null}>
      <SalesOrderDetail
        orderId={id}
        isAdmin={isAdmin}
        products={products}
        tenantCurrency={currency.code}
        companyName={tenant?.company_info?.name || tenant?.name || ""}
        middlewareHref={isAdmin && tenant?.features?.integration_middleware ? ROUTES.settingsMiddleware : null}
        whatsappPhone={whatsappPhone}
        externalLine={<ExternalRecordSlot objectType="sales_orders" objectId={id} />}
      />
    </Suspense>
  );
}
