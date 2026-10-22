import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { listPricingItems } from "@/lib/data";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import PricingClient from "./PricingClient";
import { pricingParts } from "./pricingLogic";
import { PRICING_TIPS } from "./tips";

/**
 * Settings > Pricing: Small Scale Pricing (the static rate card, with Quotations) and the way into Dynamic Pricing
 * (with that module). Admin only: every write behind it is an admin write, and the Dynamic Pricing entry it absorbs
 * was admin only.
 */
export default async function PricingConfigPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const tenant = await getTenant();
  const parts = pricingParts(tenant?.features);
  if (!parts.rateCard && !parts.engine) redirect(ROUTES.settings);
  const items = parts.rateCard ? await listPricingItems() : [];

  return (
    <>
      <SettingsPageHeader title="Pricing" info={PRICING_TIPS.page} />
      <PricingClient initialItems={items} rateCard={parts.rateCard} engine={parts.engine} />
    </>
  );
}
