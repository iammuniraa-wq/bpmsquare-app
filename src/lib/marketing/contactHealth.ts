import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/encryption";
import type { ChangeEntry } from "@/lib/changeLog";
import type { TenantFeatures } from "@/lib/constants";
import { checkEmailAddress, parseAddress, type CheckResult } from "./addressCheck";
import { stampContactEmailHash } from "./contactEmailHash";
import { isEmailStatus, nextHealth, type EmailStatus, type HealthSignal } from "./emailHealth";
import { isSchemaPending } from "./pending";

// Email health on the contact record: reading it, and the three things a person in
// sales can do about it (check the address, fix it, confirm it by other means).
// The columns (0144) are written ONLY here and by the delivery webhook, always on the
// service-role client with the tenant on every query.

/** Email health is part of the Newsletter Studio: needs the studio's platform-admin flag and the marketing module. */
export function emailHealthOn(features: Partial<TenantFeatures> | null | undefined): boolean {
  return features?.marketing === true && features?.newsletter_studio === true;
}

export type ContactHealth = {
  /** False while migration 0144 is pending: the card then says it is waiting for a database update. */
  available: boolean;
  status: EmailStatus;
  at: string | null;
  reason: string | null;
  /** True when the address is on the suppression list: nothing will be emailed to it. */
  blocked: boolean;
  lastEvent: { name: string; at: string } | null;
};

const UNAVAILABLE: ContactHealth = { available: false, status: "unknown", at: null, reason: null, blocked: false, lastEvent: null };
const DELIVERY_EVENTS = ["email.delivered", "email.bounced", "email.complained", "email.sent"];

export async function loadContactHealth(admin: SupabaseClient, tenantId: string, contactId: string): Promise<ContactHealth> {
  try {
    const { data, error } = await admin
      .from("contacts")
      .select("id, email_hash, email_status, email_status_at, email_status_reason")
      .eq("id", contactId).eq("tenant_id", tenantId).maybeSingle();
    if (error) return isSchemaPending(error) ? UNAVAILABLE : { ...UNAVAILABLE, available: true };
    if (!data) return { ...UNAVAILABLE, available: true };
    const row = data as { email_hash: string | null; email_status: string | null; email_status_at: string | null; email_status_reason: string | null };

    let blocked = false;
    if (row.email_hash) {
      const { data: sup } = await admin.from("suppressions").select("reason").eq("tenant_id", tenantId).eq("channel", "email").eq("address_hash", row.email_hash).maybeSingle();
      blocked = !!sup;
    }
    const ev = await admin.from("domain_event").select("name, occurred_at").eq("tenant_id", tenantId).eq("contact_id", contactId).in("name", DELIVERY_EVENTS).order("occurred_at", { ascending: false }).limit(1);
    const last = ((ev.data ?? []) as { name: string; occurred_at: string }[])[0];
    return {
      available: true,
      status: isEmailStatus(row.email_status) ? row.email_status : "unknown",
      at: row.email_status_at, reason: row.email_status_reason, blocked,
      lastEvent: last ? { name: last.name, at: last.occurred_at } : null,
    };
  } catch (e) {
    console.error("[email health] could not load", e);
    return UNAVAILABLE;
  }
}

export type HealthAction =
  | { action: "check" }
  | { action: "fix"; email: string }
  | { action: "confirm"; reason: string };

export type HealthActionResult =
  | { ok: true; message: string; label: string | null; changes: ChangeEntry[] }
  | { ok: false; status: number; error: string; pending?: boolean };

type Deps = { check?: (email: string) => Promise<CheckResult>; now?: () => Date };

const fail = (status: number, error: string, pending = false): HealthActionResult => ({ ok: false, status, error, ...(pending ? { pending } : {}) });

export async function runHealthAction(
  admin: SupabaseClient, tenantId: string, contactId: string, input: HealthAction, deps: Deps = {},
): Promise<HealthActionResult> {
  const check = deps.check ?? ((e: string) => checkEmailAddress(e));
  const now = (deps.now ?? (() => new Date()))().toISOString();

  const { data, error } = await admin
    .from("contacts")
    .select("id, name, email, email_status, email_status_at")
    .eq("id", contactId).eq("tenant_id", tenantId).maybeSingle();
  if (error) {
    return isSchemaPending(error)
      ? fail(503, "Email health is waiting for a database update.", true)
      : fail(500, "Could not read this contact.");
  }
  if (!data) return fail(404, "Contact not found");
  const contact = data as { id: string; name: string | null; email: string | null; email_status: string | null; email_status_at: string | null };
  const current = { status: isEmailStatus(contact.email_status) ? contact.email_status : ("unknown" as EmailStatus), at: contact.email_status_at };
  const label = contact.name ?? null;

  const writeHealth = async (signal: HealthSignal, extra: Record<string, unknown> = {}): Promise<{ change: ReturnType<typeof nextHealth>; error?: string }> => {
    const change = nextHealth(current, signal);
    if (!change && Object.keys(extra).length === 0) return { change };
    const patch: Record<string, unknown> = { ...extra };
    if (change) Object.assign(patch, { email_status: change.status, email_status_at: now, email_status_reason: change.reason });
    const { error: upErr } = await admin.from("contacts").update(patch).eq("id", contactId).eq("tenant_id", tenantId);
    if (upErr) return { change, error: isSchemaPending(upErr) ? "Email health is waiting for a database update." : "Could not save." };
    return { change };
  };
  const statusChange = (from: EmailStatus, to: EmailStatus | undefined): ChangeEntry[] => (to && to !== from ? [{ field: "Email health", from, to }] : []);

  if (input.action === "check") {
    const email = decrypt(contact.email);
    if (!email) return fail(400, "This contact has no email address to check.");
    const result = await check(email);
    const signal: HealthSignal = result.ok ? { kind: "checked_ok" } : { kind: "invalid", reason: result.reason };
    const w = await writeHealth(signal);
    if (w.error) return fail(500, w.error);
    return {
      ok: true, label,
      message: result.ok ? result.message : result.reason,
      changes: [{ field: "Email check", from: null, to: result.ok ? "Looks right" : `Not usable: ${result.reason}` }, ...statusChange(current.status, w.change?.status)],
    };
  }

  if (input.action === "confirm") {
    const reason = (input.reason ?? "").replace(/\s+/g, " ").trim();
    if (reason.length < 3) return fail(400, "Say how you confirmed it, for example \"confirmed by phone on 20 Oct\".");
    if (reason.length > 160) return fail(400, "Keep the reason under 160 characters.");
    // A blocked address stays blocked: confirming it would not make it deliverable, and the suppression list is not edited here.
    if (current.status === "bounced" || current.status === "complained") {
      return fail(409, "This address is blocked from email. Use Fix the address to give a new one.");
    }
    const w = await writeHealth({ kind: "confirmed", reason });
    if (w.error) return fail(500, w.error);
    return {
      ok: true, label, message: "Marked as checked.",
      changes: [{ field: "Email marked as checked", from: null, to: reason }, ...statusChange(current.status, w.change?.status)],
    };
  }

  if (input.action === "fix") {
    const next = (input.email ?? "").trim();
    const shape = parseAddress(next);
    if (!shape.ok) return fail(400, shape.reason);
    const before = decrypt(contact.email);
    if (before && before.trim().toLowerCase() === next.toLowerCase()) return fail(400, "That is the address already on file.");
    // New address: health starts over, then the new address is checked.
    const { error: upErr } = await admin.from("contacts")
      .update({ email: encrypt(next), email_status: "unknown", email_status_at: now, email_status_reason: null })
      .eq("id", contactId).eq("tenant_id", tenantId);
    if (upErr) return fail(500, isSchemaPending(upErr) ? "Email health is waiting for a database update." : "Could not save the new address.", isSchemaPending(upErr));
    await stampContactEmailHash(admin, tenantId, contactId, next);

    const result = await check(next);
    const signal: HealthSignal = result.ok ? { kind: "checked_ok" } : { kind: "invalid", reason: result.reason };
    const reset = { status: "unknown" as EmailStatus, at: now };
    const change = nextHealth(reset, signal);
    if (change) {
      await admin.from("contacts")
        .update({ email_status: change.status, email_status_at: now, email_status_reason: change.reason })
        .eq("id", contactId).eq("tenant_id", tenantId);
    }
    return {
      ok: true, label,
      message: result.ok ? "Address updated. " + result.message : "Address updated, but " + result.reason.charAt(0).toLowerCase() + result.reason.slice(1),
      // The address itself is PII: logged as redacted, like every other change to it.
      changes: [
        { field: "email", from: before ? "[redacted]" : null, to: "[redacted]", redacted: true },
        ...statusChange(current.status, change?.status ?? "unknown"),
      ],
    };
  }

  return fail(400, "Unknown action");
}
