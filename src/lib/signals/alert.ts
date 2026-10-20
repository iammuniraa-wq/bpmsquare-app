import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSchemaPending } from "@/lib/marketing/pending";
import { STAGE_LABEL, type Stage } from "./types";

// The owner alert. The Nova inbox already is "a comment that mentions you"
// (api/nova/inbox/route.ts), so telling an account owner an account has moved
// up is one record_comments row on the account with the owner's email in
// `mentions` -- no new inbox code. Only workspaces with Nova see their inbox;
// for the others the row is still a note on the account's timeline.

export const SIGNALS_AUTHOR = "buying-signals@system.invalid";

export type OwnerEmailResolver = (admin: SupabaseClient, ownerUserId: string) => Promise<string | null>;

export const authEmailResolver: OwnerEmailResolver = async (admin, ownerUserId) => {
  try {
    const { data } = await admin.auth.admin.getUserById(ownerUserId);
    return data?.user?.email?.toLowerCase() ?? null;
  } catch {
    return null;
  }
};

export async function notifyOwner(
  admin: SupabaseClient,
  tenantId: string,
  p: { accountId: string; accountName: string; ownerUserId: string | null; from: Stage; to: Stage; score: number; headline: string | null },
  resolve: OwnerEmailResolver = authEmailResolver,
): Promise<boolean> {
  if (!p.ownerUserId) return false;
  // The owner id is on the account row, but only a member of THIS tenant may be mentioned.
  const { data: member } = await admin.from("tenant_users").select("user_id")
    .eq("tenant_id", tenantId).eq("user_id", p.ownerUserId).maybeSingle();
  if (!member) return false;
  const email = await resolve(admin, p.ownerUserId);
  if (!email) return false;
  const body = `In market: ${p.accountName} moved from ${STAGE_LABEL[p.from]} to ${STAGE_LABEL[p.to]} (score ${p.score}).${p.headline ? ` Newest signal: ${p.headline}.` : ""}`;
  const { error } = await admin.from("record_comments").insert({
    tenant_id: tenantId, object_type: "accounts", object_id: p.accountId,
    author_id: null, author_email: SIGNALS_AUTHOR, body: body.slice(0, 2000), mentions: [email],
  });
  if (error && !isSchemaPending(error)) console.error(`[signals] owner alert not saved: ${error.message}`);
  return !error;
}
