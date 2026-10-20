import { redirect } from "next/navigation";
import { requireTenantUser, createAdminSupabase } from "@/lib/supabase-server";
import { ROUTES, type TenantFeatures } from "@/lib/constants";
import { studioEnabled } from "@/lib/newsletter/server";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import BrandKitClient from "./BrandKitClient";

/** Settings -> Marketing -> Brand kit. Gated here as well as in the menu: a workspace without the Newsletter Studio cannot reach it by URL. */
export default async function BrandKitSettingsPage() {
  let tenantId: string, role: string;
  try {
    ({ tenantId, role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);

  const { data } = await createAdminSupabase().from("tenants").select("features").eq("id", tenantId!).single();
  if (!studioEnabled(data?.features as Partial<TenantFeatures> | undefined)) redirect(ROUTES.settings);

  return (
    <>
      <SettingsPageHeader title="Brand kit" subtitle="Your logo, colours and email-safe fonts, set once and used by every newsletter" />
      <BrandKitClient />
    </>
  );
}
