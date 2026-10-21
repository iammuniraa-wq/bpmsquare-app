import { getTenant } from "@/lib/tenant";
import { createAdminSupabase } from "@/lib/supabase-server";
import { externalRefsForOne } from "@/lib/connectors/externalRef";
import ExternalRecordLine from "@/components/ExternalRecordLine";

/**
 * Server wrapper for record pages: loads this record's external links (tenant-scoped) and draws the line, or nothing.
 * Part of the Integration middleware, so a workspace without that flag gets nothing and no query: the tenant
 * comes from the request-cached getTenant(), which the layout has already read.
 */
export default async function ExternalRecordSlot({ objectType, objectId }: { objectType: string; objectId: string }) {
  const tenant = await getTenant();
  if (!tenant?.features?.integration_middleware) return null;
  const refs = await externalRefsForOne(createAdminSupabase(), tenant.id, objectType, objectId);
  return <ExternalRecordLine refs={refs} />;
}
