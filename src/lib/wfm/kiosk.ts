import "server-only";

import { createHash, createHmac, timingSafeEqual, randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

/**
 * Kiosk device auth + match tickets.
 *
 * The tablet on the door is NOT a logged-in user: its credential is a
 * bearer token generated once at registration (Settings → Workforce →
 * Kiosks), stored here only as a sha-256 hash — same pattern as scoped
 * API keys. The device's row also pins its site, so kiosk punches carry a
 * site with no GPS involved.
 *
 * The MATCH TICKET closes the gap between identify and punch: identify
 * returns a short-lived HMAC ticket naming the matched employee, and the
 * punch call must present it. Without this, anyone holding the device
 * token could punch for ARBITRARY employee ids by skipping the face step.
 * The HMAC key is derived from SUPABASE_SERVICE_ROLE_KEY (always set,
 * never client-visible) so no extra env var is needed; the device never
 * learns the key, so it cannot mint tickets.
 */

export function hashKioskToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateKioskToken(): string {
  return `kiosk_${randomBytes(24).toString("base64url")}`;
}

export type KioskDevice = {
  id: string;
  tenant_id: string;
  site_id: string;
  name: string;
};

/** Resolve the calling tablet from its Authorization: Bearer token. */
export async function authenticateKiosk(
  request: NextRequest,
  admin: SupabaseClient
): Promise<KioskDevice | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;

  const { data } = await admin
    .from("wfm_kiosk_devices")
    .select("id, tenant_id, site_id, name")
    .eq("token_hash", hashKioskToken(token))
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;

  // Fire-and-forget heartbeat; the admin screen shows when each tablet
  // last talked to us.
  void admin
    .from("wfm_kiosk_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return data as KioskDevice;
}

const TICKET_TTL_MS = 60 * 1000;

function ticketKey(): Buffer {
  return createHash("sha256")
    .update(`${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""}:bpm-kiosk-ticket`)
    .digest();
}

function ticketSig(employeeId: string, deviceId: string, exp: number): string {
  return createHmac("sha256", ticketKey())
    .update(`${employeeId}.${deviceId}.${exp}`)
    .digest("base64url");
}

export function signMatchTicket(employeeId: string, deviceId: string): string {
  const exp = Date.now() + TICKET_TTL_MS;
  return `${employeeId}.${exp}.${ticketSig(employeeId, deviceId, exp)}`;
}

/** Returns the ticketed employee id, or null if invalid/expired/foreign. */
export function verifyMatchTicket(ticket: string, deviceId: string): string | null {
  const parts = ticket.split(".");
  if (parts.length !== 3) return null;
  const [employeeId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const expected = ticketSig(employeeId, deviceId, exp);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return employeeId;
}
