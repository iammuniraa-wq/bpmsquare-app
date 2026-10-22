import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createAdminSupabase, requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { normalizeCategoryTree } from "@/lib/picklists";
import { resolveItemTypes } from "@/lib/products/itemTypes";
import { getTenantItemTypeConfig, itemTypeUsage } from "@/lib/products/itemTypesServer";
import ProductsClient from "./ProductsClient";
import { PRODUCT_TIPS } from "./tips";

/**
 * Settings > Data > Products. Categories show for a workspace with Quotations or Products (category fields can sit
 * on either); Item types only where the Products module is on. Admin only, like both of the pages it replaced.
 */
export default async function ProductsSettingsPage() {
  let ctx: Awaited<ReturnType<typeof requireTenantUser>>;
  try {
    ctx = await requireTenantUser();
  } catch {
    redirect(ROUTES.settings);
  }
  if (ctx.role !== "admin") redirect(ROUTES.settings);

  const tenant = await getTenant();
  const showTypes = tenant?.features?.products === true;
  const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", ctx.tenantId).single();
  const cfg = (data?.config ?? {}) as Record<string, unknown>;
  const types = showTypes ? resolveItemTypes(await getTenantItemTypeConfig(ctx.supabase, ctx.tenantId)) : [];
  const usage = showTypes ? await itemTypeUsage(ctx.supabase, ctx.tenantId) : {};

  return (
    <>
      <SettingsPageHeader title="Products" info={PRODUCT_TIPS.page} />
      <Suspense fallback={null}>
        <ProductsClient tree={normalizeCategoryTree(cfg.product_categories)} types={types} usage={usage} showTypes={showTypes} />
      </Suspense>
    </>
  );
}
