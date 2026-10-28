import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canSeeChannel, medianFirstReplyMinutes } from "./rules";
import { isMissingRelation, loadChannels, viewerRoleIds } from "./server";

import { readAllPages } from "@/lib/pagedRead";
// Numbers only, no mail: what the dashboard tile, the Reports metric and the daily briefing say about the Inbox.

export type InboxAnalytics = {
  /** Customer messages received in the last 7 days. */
  newThisWeek: number;
  /** Customer messages still marked new, whenever they came. */
  unhandled: number;
  /** Median minutes from a customer's first message in a conversation to our first reply (last 30 days). */
  medianFirstReplyMinutes: number | null;
};

export const NO_INBOX_ANALYTICS: InboxAnalytics = { newThisWeek: 0, unhandled: 0, medianFirstReplyMinutes: null };

/** Tolerates a missing table (migration pending): everything reads as zero. Counts are workspace-wide, never content. */
export async function getInboxAnalytics(admin: SupabaseClient, tenantId: string, now: Date = new Date()): Promise<InboxAnalytics> {
  try {
    const week = new Date(now.getTime() - 7 * 86_400_000).toISOString();
    const month = new Date(now.getTime() - 30 * 86_400_000).toISOString();
    const [recent, open, threads] = await Promise.all([
      admin.from("inbound_emails").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("direction", "in").gte("received_at", week),
      admin.from("inbound_emails").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("direction", "in").eq("status", "new"),
      readAllPages((lo, hi) => admin.from("inbound_emails").select("thread_key, direction, received_at").eq("tenant_id", tenantId).gte("received_at", month).not("thread_key", "is", null).order("id", { ascending: true }).range(lo, hi)),
    ]);
    if (recent.error || open.error) return NO_INBOX_ANALYTICS;
    return {
      newThisWeek: recent.count ?? 0,
      unhandled: open.count ?? 0,
      medianFirstReplyMinutes: medianFirstReplyMinutes((threads.data ?? []) as { thread_key: string | null; direction: "in" | "out"; received_at: string }[]),
    };
  } catch {
    return NO_INBOX_ANALYTICS;
  }
}

export type InboxBriefingRow = { channelId: string; channelName: string; count: number; oldestAt: string };

/**
 * For one person's morning briefing: per channel they may open, how many messages are new and either unassigned or
 * assigned to them, and when the oldest arrived. Counts and the channel name only; never a sender or a subject.
 */
export async function inboxBriefingRows(admin: SupabaseClient, args: { tenantId: string; userId: string; isAdmin: boolean }): Promise<InboxBriefingRow[]> {
  try {
    const { tenantId, userId, isAdmin } = args;
    const { channels, missing } = await loadChannels(admin, tenantId);
    if (missing) return [];
    const roleIds = isAdmin ? [] : await viewerRoleIds(admin, tenantId, userId);
    const mine = channels.filter((c) => c.active && canSeeChannel(c, { isAdmin, roleIds }));
    const out: InboxBriefingRow[] = [];
    for (const c of mine) {
      const { data, count, error } = await admin.from("inbound_emails").select("received_at", { count: "exact" })
        .eq("tenant_id", tenantId).eq("channel_id", c.id).eq("direction", "in").eq("status", "new")
        .or(`assigned_to.is.null,assigned_to.eq.${userId}`)
        .order("received_at", { ascending: true }).limit(1);
      if (error) { if (isMissingRelation(error)) return []; continue; }
      if (count && data?.[0]) out.push({ channelId: c.id, channelName: c.name, count, oldestAt: (data[0] as { received_at: string }).received_at });
    }
    return out;
  } catch {
    return [];
  }
}
