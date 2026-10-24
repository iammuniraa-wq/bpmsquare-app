import { notFound, redirect } from "next/navigation";
import { requireTenantUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import { ROUTES } from "@/lib/constants";
import SettingsPageHeader from "@/components/settings/SettingsPageHeader";
import { INBOX_TIPS } from "@/lib/inbox/tips";
import ChannelsClient from "./ChannelsClient";

/**
 * Settings -> Integrations -> Inbox channels. Admin only, and only in a workspace the platform admin switched the
 * `inbox` flag on for: without the flag the address is a 404, exactly like a page that does not exist.
 */
export default async function InboxChannelsPage() {
  let role: string;
  try {
    ({ role } = await requireTenantUser());
  } catch {
    redirect(ROUTES.settings);
  }
  if (role !== "admin") redirect(ROUTES.settings);
  const tenant = await getTenant();
  if (!tenant?.features?.inbox) notFound();

  return (
    <>
      <SettingsPageHeader title="Inbox channels" info={INBOX_TIPS.channelPage} />
      <ChannelsClient />
    </>
  );
}
