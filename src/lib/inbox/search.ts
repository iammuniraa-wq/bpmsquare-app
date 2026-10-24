import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTES } from "@/lib/constants";
import type { SearchResult } from "@/lib/globalSearch";
import { INBOX_LIMITS } from "./types";

/**
 * Global search over customer mail: sender and subject only (the body is encrypted at rest, so it cannot be searched),
 * only in the channels the caller was given (the ones they are on the team of), only the customer's own messages, and
 * never a purged stub's missing text. `term` is already stripped of PostgREST filter characters by the caller.
 */
export async function searchInboxMail(admin: SupabaseClient, tenantId: string, channelIds: readonly string[], term: string, limit: number): Promise<SearchResult[]> {
  if (channelIds.length === 0 || term.length < 2) return [];
  const t = term.replace(/[%_\\,()"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  if (t.length < 2) return [];
  const { data, error } = await admin.from("inbound_emails")
    .select("id, subject, from_name, from_address, channel_id, received_at")
    .eq("tenant_id", tenantId).eq("direction", "in").in("channel_id", [...channelIds])
    .or(`subject.ilike.%${t}%,from_address.ilike.%${t}%,from_name.ilike.%${t}%`)
    .order("received_at", { ascending: false }).limit(Math.min(limit, INBOX_LIMITS.maxPageSize));
  if (error) return [];
  const rows = (data ?? []) as { id: string; subject: string; from_name: string | null; from_address: string | null; received_at: string }[];
  return rows.map((r) => ({
    type: "inbox_email" as const, id: r.id, title: r.subject || "(no subject)",
    subtitle: ["Email", r.from_name || r.from_address].filter(Boolean).join(" · "),
    href: ROUTES.inboxMessage(r.id), matched: "subject/sender", created_at: r.received_at,
  }));
}
