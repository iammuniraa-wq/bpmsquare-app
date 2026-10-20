import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantFeatures } from "@/lib/constants";
import { isSchemaPending } from "../pending";

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
