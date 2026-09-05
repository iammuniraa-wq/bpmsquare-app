import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig } from "@/lib/constants";
import { emailOutputFor, type EmailOutput } from "@/lib/emailOutputRules";

export { emailOutputFor, resolveOutbound } from "@/lib/emailOutputRules";
export type { EmailOutput, RoutedEmail } from "@/lib/emailOutputRules";

/** Tenant-scoped read for senders that only hold a tenantId. */
export async function loadEmailOutput(client: SupabaseClient, tenantId: string): Promise<EmailOutput> {
  const { data } = await client.from("tenants").select("is_demo, config").eq("id", tenantId).maybeSingle();
  return emailOutputFor({ is_demo: (data?.is_demo as boolean | null) ?? false, config: (data?.config as TenantConfig | null) ?? null });
}
