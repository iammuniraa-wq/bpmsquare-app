import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";

// The shared reader for consumers of domain_event (0137): a keyset on (created_at, id) after a per-workspace cursor. Journeys
// (marketing/journeys/runner.ts) and AI automation (crew/server/planner.ts) both read events this way, so the shape lives here and
// neither imports the other's folder.

export type EventRow = {
  id: string;
  name: string;
  object_type: string;
  object_id: string | null;
  contact_id: string | null;
  account_id: string | null;
  campaign_id: string | null;
  source: string;
  depth: number;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type EventCursor = { created_at: string; id: string };

export const EVENT_BATCH = 500;

/** Events strictly after the cursor, oldest first. A keyset on (created_at, id): the filter on id happens here because created_at can tie. */
export async function eventsAfter(admin: SupabaseClient, tenantId: string, after: EventCursor, names: string[], limit = EVENT_BATCH): Promise<EventRow[]> {
  const { data, error } = await admin.from("domain_event")
    .select("id, name, object_type, object_id, contact_id, account_id, campaign_id, source, depth, payload, created_at")
    .eq("tenant_id", tenantId).in("name", names).gte("created_at", after.created_at)
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
  if (error) {
    if (isSchemaPending(error)) return [];
    throw error;
  }
  // Compared as instants: the database writes "...+00:00" and the code writes "...Z", which do not sort as strings.
  const c = Date.parse(after.created_at);
  return ((data ?? []) as EventRow[]).filter((e) => { const t = Date.parse(e.created_at); return t > c || (t === c && e.id > after.id); });
}
