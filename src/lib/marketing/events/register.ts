import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EVENTS } from "@/lib/events/catalog";
import type { EventSource } from "@/lib/events/catalog";
import { emitEvent } from "@/lib/events/emit";
import { isSchemaPending } from "@/lib/marketing/pending";
import type { RegistrationStatus } from "./rules";

// Registering a person for an event, in the one place both ways in share: a form submission (the hook in the
// Forms submit) and a rep adding a person. Tenant isolation: this runs on the service-role client, so the event and
// the contact are loaded by id AND the tenant, and every query names it. The tenant in the form hook is the one on
// the form row that was submitted, never a field of the request.

export type EventsEnabled = { marketing?: boolean; marketing_forms?: boolean; marketing_events?: boolean } | null | undefined;
export const eventsEnabled = (f: EventsEnabled): boolean => f?.marketing === true && f?.marketing_forms === true && f?.marketing_events === true;

export type RegisterInput = {
  eventId: string;
  contactId: string;
  source: "form" | "rep" | "import";
  submissionId?: string | null;
  actorId?: string | null;
  /** Straight to "attended": a walk-in checked in at the door. */
  checkedIn?: boolean;
};

export type RegisterOutcome =
  | { status: "registered" | "reregistered" | "attended"; registrationId: string }
  | { status: "already"; registrationId: string }
  | { status: "no_event" | "no_contact" | "unavailable" };

export function eventName(status: RegistrationStatus) {
  return status === "attended" ? EVENTS.EVENT_ATTENDED : status === "no_show" ? EVENTS.EVENT_NO_SHOW : EVENTS.EVENT_REGISTERED;
}

/** Tells the event stream what happened to one registration. Ids and a short reference only, never a name. */
export async function emitRegistrationEvent(
  admin: SupabaseClient, tenantId: string,
  r: { id: string; event_id: string; contact_id: string; account_id: string | null }, eventRef: string | null, status: RegistrationStatus,
  o: { actorId?: string | null; source: EventSource; stamp: string },
) {
  await emitEvent(tenantId, {
    name: eventName(status), object_type: "marketing_event", object_id: r.event_id, actor_id: o.actorId ?? null, source: o.source,
    contact_id: r.contact_id, account_id: r.account_id, key: `${r.id}:${status}:${o.stamp}`, payload: { ref: eventRef, registration_id: r.id },
  }, admin);
}

export async function registerPerson(admin: SupabaseClient, tenantId: string, i: RegisterInput): Promise<RegisterOutcome> {
  try {
    const { data: ev, error: eErr } = await admin.from("marketing_events").select("id, ref, status").eq("id", i.eventId).eq("tenant_id", tenantId).maybeSingle();
    if (eErr) return { status: isSchemaPending(eErr) ? "no_event" : "unavailable" };
    if (!ev) return { status: "no_event" };
    const event = ev as { id: string; ref: string | null };

    const { data: c } = await admin.from("contacts").select("id, account_id").eq("id", i.contactId).eq("tenant_id", tenantId).maybeSingle();
    if (!c) return { status: "no_contact" };
    const contact = c as { id: string; account_id: string };

    const now = new Date().toISOString();
    const source: EventSource = i.source === "form" ? "public_link" : "app";
    const { data: existing, error: xErr } = await admin.from("event_registrations").select("id, status, account_id")
      .eq("tenant_id", tenantId).eq("event_id", event.id).eq("contact_id", contact.id).maybeSingle();
    if (xErr) return { status: isSchemaPending(xErr) ? "no_event" : "unavailable" };
    const found = existing as { id: string; status: RegistrationStatus; account_id: string | null } | null;

    if (found) {
      if (found.status !== "cancelled") return { status: "already", registrationId: found.id };
      await admin.from("event_registrations").update({ status: "registered", updated_at: now, checked_in_at: null, checked_in_by: null }).eq("id", found.id).eq("tenant_id", tenantId);
      await emitRegistrationEvent(admin, tenantId, { id: found.id, event_id: event.id, contact_id: contact.id, account_id: found.account_id ?? contact.account_id }, event.ref, "registered", { actorId: i.actorId, source, stamp: now });
      return { status: "reregistered", registrationId: found.id };
    }

    const status: RegistrationStatus = i.checkedIn ? "attended" : "registered";
    const ins = await admin.from("event_registrations").insert({
      tenant_id: tenantId, event_id: event.id, contact_id: contact.id, account_id: contact.account_id, status, source: i.source,
      form_submission_id: i.submissionId ?? null, registered_at: now, checked_in_at: i.checkedIn ? now : null, checked_in_by: i.checkedIn ? i.actorId ?? null : null,
    }).select("id").single();
    if (ins.error || !ins.data) {
      if (ins.error?.code === "23505") {
        const { data: again } = await admin.from("event_registrations").select("id").eq("tenant_id", tenantId).eq("event_id", event.id).eq("contact_id", contact.id).maybeSingle();
        if (again) return { status: "already", registrationId: (again as { id: string }).id };
      }
      return { status: ins.error && isSchemaPending(ins.error) ? "no_event" : "unavailable" };
    }
    const reg = { id: (ins.data as { id: string }).id, event_id: event.id, contact_id: contact.id, account_id: contact.account_id };
    await emitRegistrationEvent(admin, tenantId, reg, event.ref, "registered", { actorId: i.actorId, source, stamp: now });
    if (i.checkedIn) await emitRegistrationEvent(admin, tenantId, reg, event.ref, "attended", { actorId: i.actorId, source, stamp: now });
    return { status: i.checkedIn ? "attended" : "registered", registrationId: reg.id };
  } catch (e) {
    console.error("[events] registration failed", e);
    return { status: "unavailable" };
  }
}

/**
 * The hook the Forms submit calls after it has kept a submission: every OPEN event of this workspace whose
 * registration form is the one just submitted registers the person. Never throws, so a problem here can never
 * lose the visitor's form answers; the person is already a contact with their consent recorded by then.
 */
export async function registerFromSubmission(admin: SupabaseClient, tenantId: string, p: { formId: string; contactId: string; submissionId: string | null }): Promise<number> {
  try {
    const { data, error } = await admin.from("marketing_events").select("id").eq("tenant_id", tenantId).eq("form_id", p.formId).eq("status", "open");
    if (error) return 0;
    let n = 0;
    for (const e of (data ?? []) as { id: string }[]) {
      const r = await registerPerson(admin, tenantId, { eventId: e.id, contactId: p.contactId, source: "form", submissionId: p.submissionId });
      if (r.status === "registered" || r.status === "reregistered") n++;
    }
    return n;
  } catch (e) {
    console.error("[events] form hook failed", e);
    return 0;
  }
}
