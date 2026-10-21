import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import WebhooksClient from "./WebhooksClient";
import { webhooksLibraryOn } from "./logic";
import { WEBHOOK_TIPS } from "./tips";

/**
 * Settings -> Integrations -> Webhooks. Admin only, and only in a workspace the platform admin switched the
 * `webhooks_library` flag on for: without the flag the address is a 404, exactly like a page that does not exist,
 * so an unflagged workspace keeps today's Webhooks & push page and sees nothing new.
 */
export default async function WebhooksPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  const tenant = await getTenant();
  if (!webhooksLibraryOn(tenant?.features)) notFound();

  return (
    <>
      <SettingsPageHeader title="Webhooks" info={WEBHOOK_TIPS.page} />
      <Suspense fallback={null}>
        <WebhooksClient />
      </Suspense>
    </>
  );
}
