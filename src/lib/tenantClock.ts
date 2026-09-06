import "server-only";
import { cache } from "react";
import { createAdminSupabase } from "@/lib/supabase-server";
import { DEFAULT_WFM_CONFIG, type TenantConfig } from "@/lib/constants";

// "Today" for a tenant is its own calendar date, not the server's. Vercel
// runs in UTC, so between 00:00 and 05:30 IST a `new Date().toISOString()`
// date is still yesterday -- a supplier reply or a cost figure dated today
// by an Indian user was "not yet in force" when the engine priced it
// (found on the 6 Sep 2026 walkthrough). The tenant's operating timezone is
// the one WFM already keeps in config.wfm.timezone (Asia/Kolkata by
// default); pricing reuses it rather than growing a second setting.

const tenantTimezoneCached = cache(async (tenantId: string): Promise<string> => {
  const { data } = await createAdminSupabase().from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const tz = (data?.config as TenantConfig | null)?.wfm?.timezone;
  return typeof tz === "string" && tz ? tz : DEFAULT_WFM_CONFIG.timezone;
});

export async function tenantTimezone(tenantId: string): Promise<string> {
  return tenantTimezoneCached(tenantId);
}

/** YYYY-MM-DD for `at` (default now) in the given IANA timezone. */
export function dateKeyIn(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Today's date key in the tenant's timezone. */
export async function tenantToday(tenantId: string): Promise<string> {
  return dateKeyIn(await tenantTimezone(tenantId));
}
