import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { sanitizeJourney } from "./definition";
import type { JourneyRow, JourneyStatus } from "./types";

// Reading journeys. A stored definition is run through the sanitiser again on
// every load: a row can be older than the code, and the runner must never act
// on a shape it does not recognise. A definition that no longer validates is
// returned with an empty step list and `invalid: true`, so nothing runs from it.

export type LoadedJourney = JourneyRow & { invalid?: boolean };

const COLS = "id, tenant_id, ref, name, status, definition, trigger_name, version, entry_from, went_live_at, created_at, updated_at";

export function toJourney(raw: Record<string, unknown>): LoadedJourney {
  const r = raw as unknown as JourneyRow;
  const s = sanitizeJourney(r.definition);
  if (s.ok) return { ...r, definition: s.definition };
  return { ...r, definition: { version: 1, trigger: { event: r.trigger_name ?? "", condition: null }, entry: { one_per_account: true, pause_when_in_trouble: true, lookback_days: 0 }, steps: [] }, invalid: true };
}

export type Loaded<T> = { rows: T[]; missing: boolean };

export async function listJourneyRows(admin: SupabaseClient, tenantId: string, statuses?: JourneyStatus[]): Promise<Loaded<LoadedJourney>> {
  let q = admin.from("journeys").select(COLS).eq("tenant_id", tenantId);
  if (statuses) q = q.in("status", statuses);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(500);
  if (error) {
    if (isSchemaPending(error)) return { rows: [], missing: true };
    throw error;
  }
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(toJourney), missing: false };
}

export async function loadJourneyRow(admin: SupabaseClient, tenantId: string, id: string): Promise<LoadedJourney | null> {
  const { data, error } = await admin.from("journeys").select(COLS).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error || !data) return null;
  return toJourney(data as Record<string, unknown>);
}
