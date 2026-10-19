import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
import { BlindIndexKeyMissingError, emailBlindIndex } from "./blindIndex";
import { isSchemaPending } from "./pending";

// Keeps contacts.email_hash (0138) current. It is written in a SEPARATE,
// best-effort statement after the contact write rather than inside it: a
// contact save must never fail, or change at all, because this column does not
// exist yet (migration pending) or because the key is not configured. The
// caller passes the plaintext email it just encrypted; nothing is read back.

let warnedMissingKey = false;
function reportFailure(e: unknown) {
  if (e instanceof BlindIndexKeyMissingError) {
    if (!warnedMissingKey) {
      console.error(`[email_hash] ${e.message}`);
      warnedMissingKey = true;
    }
    return;
  }
  console.error("[email_hash] not updated", e);
}

/** Sets (or clears, when the email is empty) one contact's email_hash. Never throws. */
export async function stampContactEmailHash(
  client: SupabaseClient,
  tenantId: string,
  contactId: string,
  email: string | null | undefined,
): Promise<void> {
  try {
    const hash = emailBlindIndex(email);
    const { error } = await client
      .from("contacts")
      .update({ email_hash: hash })
      .eq("id", contactId)
      .eq("tenant_id", tenantId);
    if (error && !isSchemaPending(error)) console.error(`[email_hash] update failed: ${error.message}`);
  } catch (e) {
    reportFailure(e);
  }
}

/**
 * Hashes up to `limit` of this tenant's contacts that have an email but no
 * hash yet. Used after a bulk import, where the new ids are not at hand.
 * Idempotent; never throws.
 */
export async function stampMissingContactEmailHashes(client: SupabaseClient, tenantId: string, limit = 1000): Promise<number> {
  let done = 0;
  try {
    const { data, error } = await client
      .from("contacts")
      .select("id, email")
      .eq("tenant_id", tenantId)
      .is("email_hash", null)
      .not("email", "is", null)
      .limit(limit);
    if (error) {
      if (!isSchemaPending(error)) console.error(`[email_hash] scan failed: ${error.message}`);
      return 0;
    }
    const rows = (data ?? []) as { id: string; email: string | null }[];
    for (let i = 0; i < rows.length; i += 25) {
      await Promise.all(rows.slice(i, i + 25).map(async (r) => {
        const hash = emailBlindIndex(decrypt(r.email));
        if (!hash) return;
        const { error: uErr } = await client.from("contacts").update({ email_hash: hash }).eq("id", r.id).eq("tenant_id", tenantId);
        if (!uErr) done++;
      }));
    }
  } catch (e) {
    reportFailure(e);
  }
  return done;
}
