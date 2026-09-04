import "server-only";

import webpush from "web-push";
import type { createAdminSupabase } from "@/lib/supabase-server";

type Admin = ReturnType<typeof createAdminSupabase>;

/**
 * Web push to an employee's own phone.
 *
 * Why push and not email: employees sign in by employee code, and their
 * account carries a synthetic address at employee.bpmsquare.local -- a
 * reserved domain that can never receive mail (lib/wfm/employeeLogin.ts). The
 * existing notification channel cannot physically reach them.
 *
 * Why the `web-push` package rather than hand-rolled: a push message is a
 * VAPID JWT plus a payload encrypted with ECDH + HKDF + AES128GCM per RFC
 * 8291. That is not code to write yourself, and getting it subtly wrong fails
 * silently at the push service rather than loudly here.
 */

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

let configured = false;
function ensureVapid(): boolean {
  if (!pushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      // A contact the push service can reach if our sending misbehaves. The
      // spec wants mailto: or https:; the value itself is never shown to a user.
      process.env.VAPID_SUBJECT || "mailto:support@bpmsquare.com",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    );
    configured = true;
  }
  return true;
}

export type PushMessage = {
  title: string;
  body: string;
  /** Where tapping the notification takes them. */
  url?: string;
  /** Collapse key — a later message with the same tag replaces an unread
   *  earlier one, so a phone left off overnight shows one alert, not ten. */
  tag?: string;
};

/**
 * Send to every device an employee has enabled. Returns how many actually
 * went out.
 *
 * A 404 or 410 from the push service means that subscription is dead (app
 * uninstalled, permission revoked, browser data cleared). Those rows are
 * deleted rather than retried forever -- otherwise the table only ever grows
 * and every send wastes a round trip on a device that no longer exists.
 */
export async function sendToEmployee(
  admin: Admin,
  tenantId: string,
  employeeId: string,
  message: PushMessage
): Promise<number> {
  if (!ensureVapid()) return 0;

  const { data: subs } = await admin
    .from("wfm_push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("tenant_id", tenantId)
    .eq("employee_id", employeeId);

  if (!subs || subs.length === 0) return 0;

  const payload = JSON.stringify(message);
  let sent = 0;
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint as string,
            keys: { p256dh: s.p256dh as string, auth: s.auth as string },
          },
          payload,
          { TTL: 60 * 60 }
        );
        sent += 1;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) dead.push(s.id as string);
        else console.error(`[wfm/push] send failed (${status ?? "no status"}) for subscription ${s.id}`);
      }
    })
  );

  if (dead.length > 0) {
    await admin.from("wfm_push_subscriptions").delete().in("id", dead);
  }
  if (sent > 0) {
    await admin
      .from("wfm_push_subscriptions")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("employee_id", employeeId);
  }
  return sent;
}
