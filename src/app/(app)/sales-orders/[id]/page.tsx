import { Suspense } from "react";
import { requireWorkcenterView } from "@/lib/permissions";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant, getTenantCurrency, requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import ExternalRecordSlot from "@/components/ExternalRecordSlot";
import SalesOrderDetail from "@/components/salesOrders/SalesOrderDetail";
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
  const [products, currency] = await Promise.all([standardQuoteProducts(supabase, tenantId, tenant), getTenantCurrency()]);
  const isAdmin = role === "admin";

  return (
    <Suspense fallback={null}>
      <SalesOrderDetail
        orderId={id}
        isAdmin={isAdmin}
        products={products}
        tenantCurrency={currency.code}
        middlewareHref={isAdmin && tenant?.features?.integration_middleware ? ROUTES.settingsMiddleware : null}
        externalLine={<ExternalRecordSlot objectType="sales_orders" objectId={id} />}
      />
    </Suspense>
  );
}
