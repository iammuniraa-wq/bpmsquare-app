import "server-only";
import type { KeyObject } from "node:crypto";
import type { createAdminSupabase } from "@/lib/supabase-server";
import { verifyHandoffToken } from "./crypto";
import { isMissingRelation } from "./registry";

// The instance side of a handoff, up to the point where a session would be made: signature, lifetime, instance binding, "is this
// person a platform admin in THIS database", and the single-use ledger. The platform_handoffs row written here is also the
// audit record (who, which instance, when). Order matters: the admin check comes before the jti is spent, so a token for a
// non-admin leaves no mark that could be mistaken for a use.

type Admin = ReturnType<typeof createAdminSupabase>;

export type HandoffOutcome =
  | { ok: true; userId: string; email: string }
  | { ok: false; status: number; reason: string };

export async function acceptHandoff(
  admin: Admin,
  token: unknown,
  publicKeys: KeyObject[],
  slug: string,
  nowMs = Date.now(),
): Promise<HandoffOutcome> {
  const v = verifyHandoffToken(publicKeys, token, { instanceSlug: slug }, nowMs);
  if (!v.ok) return { ok: false, status: 401, reason: v.reason };
  const { claims } = v;

  const email = claims.sub.trim().toLowerCase();
  const { data: pa } = await admin.from("platform_admins").select("id, user_id, email").eq("email", email).maybeSingle();
  if (!pa) return { ok: false, status: 403, reason: "not_platform_admin" };
  const userId = (pa as { user_id: string | null }).user_id;
  // A platform_admins row links to its sign-in on first login. Without that link there is no account to open a session for, and
  // minting one here would create a user the owner never invited.
  if (!userId) return { ok: false, status: 409, reason: "admin_has_not_signed_in_here" };

  const { error } = await admin.from("platform_handoffs").insert({ jti: claims.jti, instance_slug: slug, subject: email });
  if (error?.code === "23505") return { ok: false, status: 401, reason: "replayed" };
  if (error) {
    if (!isMissingRelation(error)) console.error("[controlPlane] handoff ledger write failed", error.message);
    // Fail closed: without the ledger a token could be used twice.
    return { ok: false, status: 503, reason: "ledger_unavailable" };
  }
  return { ok: true, userId, email };
}
