import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { requireFeature } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import MiddlewareClient from "./MiddlewareClient";
import { MIDDLEWARE_TIPS } from "./tips";

/**
 * Settings -> Integrations -> Integration middleware. Admin only, and only in a
 * workspace the platform admin switched the `integration_middleware` flag on
 * for: without it the address redirects, exactly like a page that does not exist.
 */
export default async function IntegrationMiddlewarePage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  await requireFeature("integration_middleware");

  return (
    <>
      <SettingsPageHeader title="Integration middleware" info={MIDDLEWARE_TIPS.page} />
      <Suspense fallback={null}>
        <MiddlewareClient />
      </Suspense>
    </>
  );
}
