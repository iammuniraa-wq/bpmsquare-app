import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant, getTenantCurrency } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { ORDER_TIPS } from "@/components/salesOrders/tips";
import OrderTypesClient from "./OrderTypesClient";

/** Settings > Sales > Order types. Admin only (the routes behind it are admin only too); only where Sales Orders are on. */
export default async function OrderTypesSettingsPage() {
  let ctx: Awaited<ReturnType<typeof requireTenantUser>>;
  try {
    ctx = await requireTenantUser();
  } catch {
    redirect(ROUTES.settings);
  }
  if (ctx.role !== "admin") redirect(ROUTES.settings);
  const tenant = await getTenant();
  if (!tenant?.features?.sales_orders) redirect(ROUTES.settings);
  const currency = await getTenantCurrency();

  return (
    <>
      <SettingsPageHeader title="Order types" info={ORDER_TIPS.typesPage} />
      <OrderTypesClient currency={currency.code} companyInfo={tenant.company_info ?? {}} logoUrl={tenant.logo_url ?? null} />
    </>
  );
}
