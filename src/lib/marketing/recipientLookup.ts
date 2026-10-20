import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailBlindIndex } from "./blindIndex";
import { isSchemaPending } from "./pending";

// Finding the PEOPLE behind a typed-in address, for senders (the Newsletter Studio's
// send). contacts.email_hash is a lookup key for the server only (see
// emailHashNeverLeaves.test.ts): it lives in this file so no sender names the column.

export type FoundContact = {
  id: string;
  account_id: string;
  name?: string | null;
  email: string | null;
  preferred_language?: string | null;
  created_at?: string;
};

const chunk = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const norm = (e: string): string => e.trim().toLowerCase();

/**
 * The contacts of THIS tenant whose address is one of `emails`, by blind index. An address with no
 * key configured, or nobody's contact, is simply absent from the answer. Never throws.
 */
export async function contactsForEmails(
  admin: SupabaseClient,
  tenantId: string,
  emails: string[],
): Promise<{ contactByEmail: Map<string, FoundContact>; hashByEmail: Map<string, string> }> {
  const hashByEmail = new Map<string, string>();
  for (const e of emails) {
    try { const h = emailBlindIndex(e); if (h) hashByEmail.set(norm(e), h); } catch { /* no key: an address cannot be matched to a person */ }
  }
  const contactByEmail = new Map<string, FoundContact>();
  if (hashByEmail.size === 0) return { contactByEmail, hashByEmail };

  const byHash = new Map<string, FoundContact>();
  for (const hs of chunk([...new Set(hashByEmail.values())], 150)) {
    let res: { data: unknown; error: { code?: string; message?: string } | null } = await admin
      .from("contacts").select("id, account_id, name, email, email_hash, preferred_language, created_at").eq("tenant_id", tenantId).in("email_hash", hs);
    if (res.error && isSchemaPending(res.error)) {
      res = await admin.from("contacts").select("id, account_id, name, email, email_hash, created_at").eq("tenant_id", tenantId).in("email_hash", hs);
    }
    for (const r of (res.data ?? []) as (FoundContact & { email_hash?: string | null })[]) if (r.email_hash) byHash.set(r.email_hash, r);
  }
  for (const [email, h] of hashByEmail) {
    const c = byHash.get(h);
    if (c) contactByEmail.set(email, c);
  }
  return { contactByEmail, hashByEmail };
}

/** The event field that identifies a recipient who is not a contact. Only a hash, never an address. */
export const eventIdentity = (hash: string | null | undefined): { email_hash: string | null } => ({ email_hash: hash ?? null });
