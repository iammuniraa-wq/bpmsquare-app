import "server-only";

import { createAdminSupabase } from "@/lib/supabase-server";
import { dateKeyInTz, getWfmConfig } from "./server";

/** Today's date (YYYY-MM-DD) in the tenant's own timezone: the day an employee is made obsolete on. */
export async function tenantToday(tenantId: string): Promise<string> {
  const config = await getWfmConfig(createAdminSupabase(), tenantId);
  return dateKeyInTz(new Date(), config.timezone);
}
