import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailBlindIndex } from "./blindIndex";

/**
 * The contact in THIS workspace who has this e-mail address, found by the blind index (contacts.email_hash, 0138), or null.
 * The hash is computed and compared here and never returned, so it stays on the server (emailHashNeverLeaves.test.ts).
 * Needs FIELD_ENCRYPTION_KEY and the 0138 column: without either it answers null, never an error.
 */
export async function findContactByEmail(
  client: SupabaseClient, tenantId: string, email: string | null | undefined,
): Promise<{ id: string; name: string | null; account_id: string | null } | null> {
  let hash: string | null = null;
  try { hash = emailBlindIndex(email); } catch { return null; }
  if (!hash) return null;
  const { data, error } = await client.from("contacts").select("id, name, account_id").eq("tenant_id", tenantId).eq("email_hash", hash).limit(1);
  if (error) return null;
  const c = ((data ?? [])[0] ?? null) as { id: string; name: string | null; account_id: string | null } | null;
  return c;
}
