import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadContact, mainContactOf, type PersonRow } from "./facts";
import { subjectKey, type EventLike } from "./rules";
import type { JourneyDefinition } from "./types";

// Who an event is about, and the key that makes them enter a journey at most
// once. The runner enrols with this and the "who would enter" preview counts
// with this, so the preview can never promise a person the runner would not take.

export type Subject = { contact: PersonRow | null; accountId: string | null; key: string | null };

export async function resolveSubject(admin: SupabaseClient, tenantId: string, def: Pick<JourneyDefinition, "entry">, ev: Pick<EventLike, "contact_id" | "account_id">): Promise<Subject> {
  let contact: PersonRow | null = ev.contact_id ? await loadContact(admin, tenantId, ev.contact_id) : null;
  const accountId = contact?.account_id ?? ev.account_id ?? null;
  if (!contact && accountId) contact = await mainContactOf(admin, tenantId, accountId);
  return { contact, accountId, key: subjectKey(def.entry.one_per_account, contact?.id ?? null, accountId) };
}
