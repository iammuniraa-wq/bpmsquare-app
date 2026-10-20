import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantFeatures } from "@/lib/constants";
import { isSchemaPending } from "./pending";

// When a contact's address newly bounces, the account owner gets an item in the Nova
// inbox. The inbox is "a comment that mentions you" (record_comments, 0089), so this
// writes one system comment on the contact, authored by nobody, mentioning the owner.
// Best effort and silent on any problem: the bounce itself is already recorded.
//
// Only for a workspace with the Nova experience on (the inbox does not exist
// otherwise), and only for an owner who is a member of THIS tenant.

export async function notifyOwnerOfBounce(
  admin: SupabaseClient,
  tenantId: string,
  p: { contactId: string; accountId: string | null; contactName?: string | null },
): Promise<boolean> {
  try {
    if (!p.accountId) return false;
    const { data: tenant } = await admin.from("tenants").select("features").eq("id", tenantId).maybeSingle();
    const f = (tenant?.features ?? {}) as Partial<TenantFeatures>;
    if (!f.next_experience && !f.spectacular_theme) return false;

    const { data: account } = await admin.from("accounts").select("owner_user_id").eq("id", p.accountId).eq("tenant_id", tenantId).maybeSingle();
    const ownerId = (account as { owner_user_id?: string | null } | null)?.owner_user_id;
    if (!ownerId) return false;

    const { data: member } = await admin.from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("user_id", ownerId).maybeSingle();
    if (!member) return false;

    const { data: user } = await admin.auth.admin.getUserById(ownerId);
    const email = user?.user?.email?.toLowerCase();
    if (!email) return false;

    const who = (p.contactName ?? "").trim() || "this contact";
    const { error } = await admin.from("record_comments").insert({
      tenant_id: tenantId, object_type: "contacts", object_id: p.contactId,
      author_id: null, author_email: null,
      body: `The email address for ${who} bounced, so we have stopped emailing it. Open the Marketing tab to fix the address.`,
      mentions: [email],
    });
    if (error && !isSchemaPending(error)) console.error(`[email health] owner notice not written: ${error.message}`);
    return !error;
  } catch (e) {
    console.error("[email health] owner notice failed", e);
    return false;
  }
}
