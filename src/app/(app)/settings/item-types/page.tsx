import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { resolveItemTypes } from "@/lib/products/itemTypes";
import { getTenantItemTypeConfig, itemTypeUsage } from "@/lib/products/itemTypesServer";
import ItemTypesClient from "./ItemTypesClient";

export default async function ItemTypesPage() {
  let ctx: Awaited<ReturnType<typeof requireTenantUser>>;
  try {
    ctx = await requireTenantUser();
  } catch {
    redirect(ROUTES.settings);
  }
  if (ctx.role !== "admin") redirect(ROUTES.settings);
  await requireFeature("products");

  const config = await getTenantItemTypeConfig(ctx.supabase, ctx.tenantId);
  return (
    <>
      <SettingsPageHeader
        title="Item types"
        subtitle="What kinds of items your products are: rename them, hide the ones you do not use, or add your own"
      />
      <ItemTypesClient initial={resolveItemTypes(config)} usage={await itemTypeUsage(ctx.supabase, ctx.tenantId)} />
    </>
  );
}
