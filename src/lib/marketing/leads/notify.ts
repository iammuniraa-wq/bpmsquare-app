import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantConfig, TenantFeatures } from "@/lib/constants";
import { isSchemaPending } from "../pending";
import { handoverOf } from "./handover";

// "Ready for sales" in the owner's Nova inbox. The inbox is built from comments
// that mention a person (record_comments.mentions, 0089), so telling the owner
// is one system-written comment on the lead that mentions their email. No new
// table, and the same read markers and bell as every other mention.
//
// Written only for a workspace that has the Nova surfaces: the inbox does not
// exist for anyone else, and a comment nobody can see is just clutter.

export const NOTICE_AUTHOR = "Lead scoring";

export async function notifyLeadReady(
  admin: SupabaseClient,
  tenantId: string,
  p: { leadId: string; title: string; ownerUserId: string; score: number | null; dueAt: Date | null; features: Partial<TenantFeatures> | null | undefined },
): Promise<boolean> {
  try {
    if (!(p.features?.next_experience === true || p.features?.spectacular_theme === true)) return false;
    const { data: member } = await admin
      .from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("user_id", p.ownerUserId).maybeSingle();
    if (!member) return false;
    const { data: user } = await admin.auth.admin.getUserById(p.ownerUserId);
    const email = user?.user?.email?.toLowerCase();
    if (!email) return false;

    const title = p.title.replace(/\s+/g, " ").trim().slice(0, 120) || "A lead";
    const due = p.dueAt ? ` Please respond by ${p.dueAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}.` : "";
    const body = `Ready for sales: ${title}${p.score != null ? ` (score ${p.score})` : ""}.${due}`;

    const { error } = await admin.from("record_comments").insert({
      tenant_id: tenantId, object_type: "leads", object_id: p.leadId,
      author_id: null, author_email: NOTICE_AUTHOR, body, mentions: [email],
    });
    if (error) {
      if (!isSchemaPending(error)) console.error(`[leads] ready notice not written: ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[leads] ready notice failed", e);
    return false;
  }
}

// ── Overdue ──────────────────────────────────────────────────────────────────
// A ready lead past its response time (lead.sla_breached, emitted once per lead by the scoring run) is
// announced once, in the Nova inbox, to the people the Hand-over settings name. The same kind of system
// comment that carries "ready for sales" carries this: a comment on the lead that mentions the person, no
// new table. The comment itself is the once-only marker, so a second run finds it and writes nothing.

export const OVERDUE_AUTHOR = "Lead hand-over";

export type OverdueLead = { id: string; account_id: string; title: string | null; owner_user_id: string | null; sla_due_at: string };

/** Which of these leads already have their overdue notice. One query for the whole batch. */
export async function leadsAlreadyAnnounced(admin: SupabaseClient, tenantId: string, leadIds: string[]): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();
  const { data, error } = await admin
    .from("record_comments").select("object_id")
    .eq("tenant_id", tenantId).eq("object_type", "leads").eq("author_email", OVERDUE_AUTHOR).in("object_id", leadIds);
  if (error) return new Set(leadIds); // when unsure, say nothing rather than twice
  return new Set(((data ?? []) as { object_id: string }[]).map((r) => r.object_id));
}

export type OverdueResult = { written: boolean; reason?: "no_nova" | "nobody_chosen" | "no_recipient" | "failed" };

export async function notifyLeadOverdue(
  admin: SupabaseClient,
  tenantId: string,
  p: { lead: OverdueLead; features: Partial<TenantFeatures> | null | undefined; config: Partial<TenantConfig> | null | undefined; teamLead?: (accountId: string) => Promise<string | null> },
): Promise<OverdueResult> {
  try {
    if (!(p.features?.next_experience === true || p.features?.spectacular_theme === true)) return { written: false, reason: "no_nova" };
    const choice = handoverOf(p.config).overdue_notify;
    if (!choice.owner && !choice.team_lead) return { written: false, reason: "nobody_chosen" };

    const wanted: string[] = [];
    if (choice.owner && p.lead.owner_user_id) wanted.push(p.lead.owner_user_id);
    if (choice.team_lead && p.teamLead) {
      const lead = await p.teamLead(p.lead.account_id);
      if (lead) wanted.push(lead);
    }
    const ids = [...new Set(wanted)];
    if (ids.length === 0) return { written: false, reason: "no_recipient" };

    // Only people who belong to THIS workspace can be told; the id never comes from a request.
    const { data: members } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).in("user_id", ids);
    const inside = new Set(((members ?? []) as { user_id: string }[]).map((m) => m.user_id));
    const emails: string[] = [];
    for (const id of ids.filter((x) => inside.has(x))) {
      const { data: user } = await admin.auth.admin.getUserById(id);
      const email = user?.user?.email?.toLowerCase();
      if (email) emails.push(email);
    }
    if (emails.length === 0) return { written: false, reason: "no_recipient" };

    const title = (p.lead.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "A lead";
    const due = new Date(p.lead.sla_due_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    const { error } = await admin.from("record_comments").insert({
      tenant_id: tenantId, object_type: "leads", object_id: p.lead.id,
      author_id: null, author_email: OVERDUE_AUTHOR, body: `Overdue: ${title} was due on ${due} and nobody has picked it up yet.`, mentions: emails,
    });
    if (error) {
      if (!isSchemaPending(error)) console.error(`[leads] overdue notice not written: ${error.message}`);
      return { written: false, reason: "failed" };
    }
    return { written: true };
  } catch (e) {
    console.error("[leads] overdue notice failed", e);
    return { written: false, reason: "failed" };
  }
}
