import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";
import { isSchemaPending } from "@/lib/marketing/pending";
import { normalisePhone, phoneBlindIndex } from "./phone";

// "Match my contacts' numbers": hashes the phones of this workspace's contacts into whatsapp_numbers (0188) so
// an inbound reply from a number we never messaged (a START, for example) can be matched to a person. Done in
// slices by id so one click never reads the whole table; the page calls it again with `after` until `done`.

export const SLICE = 500;

export type MatchResult = { scanned: number; matched: number; skipped: number; last: string | null; done: boolean; missing: boolean };

export async function indexContactNumbers(admin: SupabaseClient, tenantId: string, after: string | null): Promise<MatchResult> {
  let q = admin.from("contacts").select("id, phone, country, account_id").eq("tenant_id", tenantId).order("id", { ascending: true }).limit(SLICE);
  if (after) q = q.gt("id", after);
  const { data, error } = await q;
  if (error) return { scanned: 0, matched: 0, skipped: 0, last: null, done: true, missing: isSchemaPending(error) };
  const rows = (data ?? []) as { id: string; phone: string | null; country: string | null }[];
  const out: { tenant_id: string; contact_id: string; phone_hash: string }[] = [];
  let skipped = 0;
  for (const r of rows) {
    const n = normalisePhone(decrypt(r.phone), r.country);
    if (!n) { skipped++; continue; }
    out.push({ tenant_id: tenantId, contact_id: r.id, phone_hash: phoneBlindIndex(n) });
  }
  if (out.length) {
    const { error: wErr } = await admin.from("whatsapp_numbers").upsert(out, { onConflict: "tenant_id,contact_id,phone_hash", ignoreDuplicates: true });
    if (wErr) return { scanned: rows.length, matched: 0, skipped, last: null, done: true, missing: isSchemaPending(wErr) };
  }
  return { scanned: rows.length, matched: out.length, skipped, last: rows.length ? rows[rows.length - 1].id : after, done: rows.length < SLICE, missing: false };
}
