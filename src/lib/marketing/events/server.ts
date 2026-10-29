import "server-only";
import { diffForLog, logChange } from "@/lib/changeLog";
import { insertWithMasterRef } from "@/lib/masterRef";
import { isUuid, type ModuleCtx, type ModuleSpec } from "@/lib/marketing/moduleAccess";
import { isSchemaPending } from "@/lib/marketing/pending";
import { journeysEnabled, loadTenantEnv } from "@/lib/marketing/journeys/env";
import { defaultOwnerLookup } from "@/lib/marketing/journeys/facts";
import { enrolFromEvent } from "@/lib/marketing/journeys/runner";
import type { EventLike } from "@/lib/marketing/journeys/rules";
import { loadJourneyRow } from "@/lib/marketing/journeys/store";
import { listMembersForPicker } from "@/lib/sales/opportunityServer";
import { emitRegistrationEvent, registerPerson, type RegisterOutcome } from "./register";
import {
  EVENT_STATUSES, canMove, resultsOf, sanitizeEvent, type EventKind, type EventSave, type EventStatus, type FollowUpOn, type RegistrationStatus, type Results,
} from "./rules";

import { readAllPages } from "@/lib/pagedRead";
// Marketing events: the signed-in side. Events use the SESSION client (the 0195 policy is the real backstop) and every
// query also names the tenant; registrations are select-only to members (0196), so they are written with the
// service-role client after moduleAccess() -> requireTenantUser(), and every one of those queries names the tenant.
// A foreign id in a body (the form, the journey, the owner, a contact) is loaded with its own tenant filter first.

export const EVENTS_SPEC: ModuleSpec = { flag: "marketing_events", also: ["marketing_forms"], workcenter: "marketing_events", label: "Events", migrations: "0195 and 0196" };

export type EventRecord = {
  id: string; tenant_id: string; ref: string | null; name: string; kind: EventKind; status: EventStatus; starts_at: string; ends_at: string | null;
  venue: string | null; link: string | null; capacity: number | null; description: string | null; form_id: string | null;
  follow_up_journey_id: string | null; follow_up_on: FollowUpOn; owner_user_id: string | null; created_at: string; updated_at: string;
};

export type Loaded<T> = { data: T | null; missing: boolean };

export async function loadEvent(ctx: ModuleCtx, id: string): Promise<Loaded<EventRecord>> {
  if (!isUuid(id)) return { data: null, missing: false };
  const { data, error } = await ctx.supabase.from("marketing_events").select("*").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle();
  if (error) return { data: null, missing: isSchemaPending(error) };
  return { data: (data as EventRecord | null) ?? null, missing: false };
}

export type ListParams = { q: string; status: EventStatus | null; page: number; page_size: number };

export function parseListParams(sp: URLSearchParams): ListParams {
  const page = Number.parseInt(sp.get("page") ?? "1", 10);
  const status = sp.get("status");
  return {
    q: (sp.get("q") ?? "").replace(/[^\p{L}\p{N} _.-]/gu, "").trim().slice(0, 60),
    status: (EVENT_STATUSES as readonly string[]).includes(status ?? "") ? (status as EventStatus) : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    page_size: 20,
  };
}

export type ListedEvent = Pick<EventRecord, "id" | "ref" | "name" | "kind" | "status" | "starts_at" | "venue" | "capacity"> & { registered: number; attended: number };

export async function listEvents(ctx: ModuleCtx, p: ListParams): Promise<{ rows: ListedEvent[]; total: number; missing: boolean }> {
  let q = ctx.supabase.from("marketing_events").select("id, ref, name, kind, status, starts_at, venue, capacity", { count: "exact" }).eq("tenant_id", ctx.tenantId);
  if (p.status) q = q.eq("status", p.status);
  if (p.q) q = q.or(`name.ilike.%${p.q}%,ref.ilike.%${p.q}%,venue.ilike.%${p.q}%`);
  const from = (p.page - 1) * p.page_size;
  const { data, error, count } = await q.order("starts_at", { ascending: false }).order("id").range(from, from + p.page_size - 1);
  if (error) {
    if (isSchemaPending(error)) return { rows: [], total: 0, missing: true };
    throw { status: 500, message: "Could not load events" };
  }
  const base = (data ?? []) as Omit<ListedEvent, "registered" | "attended">[];
  const regs = base.length
    ? await readAllPages((lo, hi) => ctx.supabase.from("event_registrations").select("event_id, status").eq("tenant_id", ctx.tenantId).in("event_id", base.map((r) => r.id)).order("id", { ascending: true }).range(lo, hi))
    : { data: [] as { event_id: string; status: RegistrationStatus }[] };
  const tally = new Map<string, { registered: number; attended: number }>();
  for (const r of (regs.data ?? []) as { event_id: string; status: RegistrationStatus }[]) {
    const t = tally.get(r.event_id) ?? { registered: 0, attended: 0 };
    if (r.status !== "cancelled") t.registered++;
    if (r.status === "attended") t.attended++;
    tally.set(r.event_id, t);
  }
  return { rows: base.map((r) => ({ ...r, registered: tally.get(r.id)?.registered ?? 0, attended: tally.get(r.id)?.attended ?? 0 })), total: count ?? base.length, missing: false };
}

// ── the foreign ids in a save ────────────────────────────────────────────────

async function verifyReferences(ctx: ModuleCtx, v: EventSave, selfId: string | null): Promise<void> {
  if (v.form_id) {
    const { data, error } = await ctx.admin.from("forms").select("id, status").eq("id", v.form_id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (error && isSchemaPending(error)) throw { status: 503, message: "Forms are waiting for a database update." };
    const f = data as { status: string } | null;
    if (!f || f.status === "archived") throw { status: 422, message: "That form could not be found." };
    // One registration form belongs to one running event, or a submission would register the person for both.
    let q = ctx.admin.from("marketing_events").select("id, name").eq("tenant_id", ctx.tenantId).eq("form_id", v.form_id).in("status", ["draft", "open", "closed"]);
    if (selfId) q = q.neq("id", selfId);
    const { data: other } = await q.limit(1);
    const o = ((other ?? []) as { name: string }[])[0];
    if (o && v.status !== "completed" && v.status !== "cancelled") throw { status: 409, message: `That form already registers people for "${o.name}". Use a different form.` };
  }
  if (v.follow_up_journey_id) {
    const { data, error } = await ctx.admin.from("journeys").select("id, status").eq("id", v.follow_up_journey_id).eq("tenant_id", ctx.tenantId).maybeSingle();
    if (error && isSchemaPending(error)) throw { status: 503, message: "Journeys are waiting for a database update." };
    if (!data || (data as { status: string }).status === "archived") throw { status: 422, message: "That journey could not be found." };
  }
  if (v.owner_user_id) {
    const { data } = await ctx.admin.from("tenant_users").select("user_id").eq("tenant_id", ctx.tenantId).eq("user_id", v.owner_user_id).maybeSingle();
    if (!data) throw { status: 422, message: "That colleague could not be found." };
  }
}

export async function createEvent(ctx: ModuleCtx, body: unknown): Promise<{ id: string; ref: string | null } | { missing: true }> {
  const r = sanitizeEvent(body, ctx.tenant.timezone);
  if (!r.ok) throw { status: 422, message: r.error };
  const v = { ...r.value, owner_user_id: r.value.owner_user_id ?? ctx.userId };
  await verifyReferences(ctx, v, null);
  const { data, error } = await insertWithMasterRef<{ id: string; ref: string | null }>(ctx.supabase, "marketing_events", ctx.tenantId, { tenant_id: ctx.tenantId, ...v, created_by: ctx.userId }, "id, ref");
  if (error || !data) {
    if (error && isSchemaPending(error)) return { missing: true };
    throw { status: 500, message: "Could not save the event" };
  }
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "marketing_events", objectId: data.id, objectLabel: data.ref ?? v.name, action: "create", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "name", from: null, to: v.name }] });
  return data;
}

export async function saveEvent(ctx: ModuleCtx, id: string, body: unknown): Promise<{ missing: true } | { ok: true }> {
  const current = await loadEvent(ctx, id);
  if (current.missing) return { missing: true };
  if (!current.data) throw { status: 404, message: "Event not found" };

  // A status move on its own (Open registration, Cancel, Mark completed): { status } and nothing else.
  const keys = body && typeof body === "object" ? Object.keys(body as object) : [];
  if (keys.length === 1 && keys[0] === "status") {
    const next = (body as { status: unknown }).status;
    if (typeof next !== "string" || !(EVENT_STATUSES as readonly string[]).includes(next)) throw { status: 422, message: "That is not a status." };
    const before = current.data.status;
    if (next === before) return { ok: true };
    if (next === "open" && current.data.form_id) await verifyReferences(ctx, { ...(current.data as unknown as EventSave), status: "open" }, id);
    const { error: sErr } = await ctx.supabase.from("marketing_events").update({ status: next, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId);
    if (sErr) throw { status: 500, message: "Could not save the event" };
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "marketing_events", objectId: id, objectLabel: current.data.ref ?? current.data.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "status", from: before, to: next }] });
    return { ok: true };
  }

  const r = sanitizeEvent(body, ctx.tenant.timezone);
  if (!r.ok) throw { status: 422, message: r.error };
  await verifyReferences(ctx, r.value, id);
  const { error } = await ctx.supabase.from("marketing_events").update({ ...r.value, updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) throw { status: 500, message: "Could not save the event" };
  const changes = diffForLog("marketing_events", current.data as unknown as Record<string, unknown>, r.value as unknown as Record<string, unknown>);
  if (changes.length) {
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "marketing_events", objectId: id, objectLabel: current.data.ref ?? current.data.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes });
  }
  return { ok: true };
}

/** An event people registered for is cancelled, not deleted: the registrations and what was recorded about them stay. */
export async function deleteEvent(ctx: ModuleCtx, id: string): Promise<"deleted" | "cancelled" | "missing" | "not_found"> {
  const current = await loadEvent(ctx, id);
  if (current.missing) return "missing";
  if (!current.data) return "not_found";
  const { data } = await ctx.admin.from("event_registrations").select("id").eq("tenant_id", ctx.tenantId).eq("event_id", id).limit(1);
  if (((data ?? []) as unknown[]).length > 0) {
    await ctx.supabase.from("marketing_events").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", id).eq("tenant_id", ctx.tenantId);
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "marketing_events", objectId: id, objectLabel: current.data.ref ?? current.data.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "status", from: current.data.status, to: "cancelled" }] });
    return "cancelled";
  }
  const { error } = await ctx.supabase.from("marketing_events").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) throw { status: 500, message: "Could not delete the event" };
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "marketing_events", objectId: id, objectLabel: current.data.ref ?? current.data.name, action: "delete", actorId: ctx.userId, actorEmail: ctx.email, changes: [] });
  return "deleted";
}

// ── registrations ────────────────────────────────────────────────────────────

export type AttendeeRow = {
  id: string; contactId: string; name: string; company: string; status: RegistrationStatus; source: string;
  registeredAt: string; checkedInAt: string | null; followedUp: boolean; ownerName: string | null;
};

const ATTENDEE_LIMIT = 300;
const OWNER_LOOKUPS = 60;

/** The attendee list. A name and a company only: no phone, no email. The owner is the company's, through Coverage. */
export async function listAttendees(ctx: ModuleCtx, eventId: string): Promise<{ rows: AttendeeRow[]; total: number; missing: boolean }> {
  const { data, error, count } = await ctx.supabase.from("event_registrations")
    .select("id, contact_id, account_id, status, source, registered_at, checked_in_at, follow_up_started_at", { count: "exact" })
    .eq("tenant_id", ctx.tenantId).eq("event_id", eventId).order("registered_at", { ascending: false }).limit(ATTENDEE_LIMIT);
  if (error) return { rows: [], total: 0, missing: isSchemaPending(error) };
  const regs = (data ?? []) as { id: string; contact_id: string; account_id: string | null; status: RegistrationStatus; source: string; registered_at: string; checked_in_at: string | null; follow_up_started_at: string | null }[];
  const cIds = [...new Set(regs.map((r) => r.contact_id))];
  const aIds = [...new Set(regs.map((r) => r.account_id).filter((x): x is string => !!x))];
  const [cs, as] = await Promise.all([
    cIds.length ? ctx.supabase.from("contacts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", cIds) : { data: [] },
    aIds.length ? ctx.supabase.from("accounts").select("id, name").eq("tenant_id", ctx.tenantId).in("id", aIds) : { data: [] },
  ]);
  const cName = new Map(((cs.data ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));
  const aName = new Map(((as.data ?? []) as { id: string; name: string }[]).map((a) => [a.id, a.name]));

  // Owners through Coverage (live), for the first rows only: Coverage matching costs a few queries per company.
  const owners = new Map<string, string | null>();
  let names = new Map<string, string>();
  try {
    names = new Map((await listMembersForPicker(ctx.admin, ctx.tenantId)).map((m) => [m.user_id, m.name ?? m.email ?? "A colleague"]));
  } catch { /* names are a nicety */ }
  for (const id of aIds.slice(0, OWNER_LOOKUPS)) {
    try { owners.set(id, await defaultOwnerLookup(ctx.tenantId, id)); } catch { owners.set(id, null); }
  }
  return {
    missing: false, total: count ?? regs.length,
    rows: regs.map((r) => ({
      id: r.id, contactId: r.contact_id, name: cName.get(r.contact_id) ?? "Unknown", company: (r.account_id && aName.get(r.account_id)) || "",
      status: r.status, source: r.source, registeredAt: r.registered_at, checkedInAt: r.checked_in_at, followedUp: !!r.follow_up_started_at,
      ownerName: (r.account_id && owners.get(r.account_id) && names.get(owners.get(r.account_id) as string)) || null,
    })),
  };
}

export async function loadResults(ctx: ModuleCtx, event: Pick<EventRecord, "id" | "capacity">): Promise<Results> {
  const { data } = await readAllPages((lo, hi) => ctx.supabase.from("event_registrations").select("status").eq("tenant_id", ctx.tenantId).eq("event_id", event.id).order("id", { ascending: true }).range(lo, hi));
  return resultsOf(((data ?? []) as { status: RegistrationStatus }[]).map((r) => r.status), event.capacity);
}

export async function addRegistration(ctx: ModuleCtx, eventId: string, contactId: unknown, checkIn: boolean): Promise<RegisterOutcome> {
  if (!isUuid(contactId)) throw { status: 422, message: "Choose a person." };
  const ev = await loadEvent(ctx, eventId);
  if (ev.missing) return { status: "no_event" };
  if (!ev.data) throw { status: 404, message: "Event not found" };
  if (ev.data.status === "cancelled") throw { status: 409, message: "This event is cancelled." };
  return registerPerson(ctx.admin, ctx.tenantId, { eventId, contactId, source: "rep", actorId: ctx.userId, checkedIn: checkIn });
}

/** Staff check a person in, mark them as not coming, or cancel them. Final states stay final (rules.ts). */
export async function moveRegistration(ctx: ModuleCtx, eventId: string, registrationId: string, to: unknown): Promise<{ status: RegistrationStatus }> {
  if (!isUuid(registrationId) || typeof to !== "string" || !["registered", "attended", "no_show", "cancelled"].includes(to)) throw { status: 422, message: "That is not a status." };
  const next = to as RegistrationStatus;
  const ev = await loadEvent(ctx, eventId);
  if (!ev.data) throw { status: 404, message: "Event not found" };
  const { data } = await ctx.admin.from("event_registrations").select("id, event_id, contact_id, account_id, status").eq("id", registrationId).eq("event_id", eventId).eq("tenant_id", ctx.tenantId).maybeSingle();
  const reg = data as { id: string; event_id: string; contact_id: string; account_id: string | null; status: RegistrationStatus } | null;
  if (!reg) throw { status: 404, message: "Registration not found" };
  if (reg.status === next) return { status: next };
  if (!canMove(reg.status, next)) throw { status: 409, message: reg.status === "attended" ? "This person is already checked in, and that is final." : "That change is not allowed." };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status: next, updated_at: now };
  if (next === "attended") { patch.checked_in_at = now; patch.checked_in_by = ctx.userId; }
  if (next === "registered") { patch.checked_in_at = null; patch.checked_in_by = null; }
  const { error } = await ctx.admin.from("event_registrations").update(patch).eq("id", reg.id).eq("tenant_id", ctx.tenantId);
  if (error) throw { status: 500, message: "Could not save that" };
  if (next === "attended" || next === "no_show" || next === "registered") await emitRegistrationEvent(ctx.admin, ctx.tenantId, reg, ev.data.ref, next, { actorId: ctx.userId, source: "app", stamp: now });
  await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "event_registrations", objectId: reg.id, objectLabel: ev.data.ref ?? ev.data.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "status", from: reg.status, to: next }] });
  return { status: next };
}

/** After the event: everyone still "registered" is marked as not having come. Refused before it has started. */
export async function markRemainingNoShows(ctx: ModuleCtx, eventId: string, now: Date = new Date()): Promise<{ marked: number }> {
  const ev = await loadEvent(ctx, eventId);
  if (!ev.data) throw { status: 404, message: "Event not found" };
  if (Date.parse(ev.data.starts_at) > now.getTime()) throw { status: 409, message: "The event has not started yet." };
  const { data } = await readAllPages((lo, hi) => ctx.admin.from("event_registrations").select("id, event_id, contact_id, account_id").eq("tenant_id", ctx.tenantId).eq("event_id", eventId).eq("status", "registered").order("id", { ascending: true }).range(lo, hi));
  const rows = (data ?? []) as { id: string; event_id: string; contact_id: string; account_id: string | null }[];
  const stamp = now.toISOString();
  let marked = 0;
  for (const reg of rows) {
    const { error } = await ctx.admin.from("event_registrations").update({ status: "no_show", updated_at: stamp }).eq("id", reg.id).eq("tenant_id", ctx.tenantId).eq("status", "registered");
    if (error) continue;
    await emitRegistrationEvent(ctx.admin, ctx.tenantId, reg, ev.data.ref, "no_show", { actorId: ctx.userId, source: "app", stamp });
    marked++;
  }
  if (marked) {
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "marketing_events", objectId: eventId, objectLabel: ev.data.ref ?? ev.data.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "no_shows_marked", from: null, to: marked }] });
  }
  return { marked };
}

// ── the follow-up ────────────────────────────────────────────────────────────

export type FollowUpResult = { enrolled: number; already: number; skipped: number };

/**
 * Starts the event's chosen journey for the people the event says (those who came, or those who did not), through
 * the journey runner's own enrolment function: nothing new is automated here. The journey must be turned on, and it
 * keeps every consent and quiet-hours rule of its own. A person is stamped once started, so pressing the button
 * again enrols nobody twice (and a person who already went through that journey is not put through it again).
 */
export async function startFollowUp(ctx: ModuleCtx, eventId: string, now: Date = new Date()): Promise<FollowUpResult> {
  const ev = await loadEvent(ctx, eventId);
  if (!ev.data) throw { status: 404, message: "Event not found" };
  const event = ev.data;
  if (!event.follow_up_journey_id) throw { status: 422, message: "Choose a journey first." };

  const env = await loadTenantEnv(ctx.admin, ctx.tenantId);
  if (!env || !journeysEnabled(env.features)) throw { status: 409, message: "Journeys are not switched on for this workspace." };
  const journey = await loadJourneyRow(ctx.admin, ctx.tenantId, event.follow_up_journey_id);
  if (!journey) throw { status: 422, message: "That journey could not be found." };
  if (journey.status !== "live") throw { status: 409, message: "Turn the journey on first. It is not running." };
  if (journey.invalid) throw { status: 409, message: "That journey needs fixing before it can run." };

  const { data } = await ctx.admin.from("event_registrations").select("id, contact_id, account_id, checked_in_at, updated_at, follow_up_started_at")
    .eq("tenant_id", ctx.tenantId).eq("event_id", eventId).eq("status", event.follow_up_on).limit(500);
  const rows = (data ?? []) as { id: string; contact_id: string; account_id: string | null; checked_in_at: string | null; updated_at: string; follow_up_started_at: string | null }[];
  const result: FollowUpResult = { enrolled: 0, already: 0, skipped: 0 };
  const name = event.follow_up_on === "attended" ? "event.attended" : "event.no_show";
  for (const reg of rows) {
    if (reg.follow_up_started_at) { result.already++; continue; }
    const like: EventLike = {
      id: reg.id, name, object_type: "marketing_event", object_id: event.id, contact_id: reg.contact_id, account_id: reg.account_id, campaign_id: null,
      source: "app", depth: 0, payload: { ref: event.ref }, created_at: reg.checked_in_at ?? reg.updated_at,
    };
    const outcome = await enrolFromEvent(ctx.admin, env, journey, like, now);
    if (outcome === "enrolled") result.enrolled++;
    else if (outcome === "duplicate") result.already++;
    else result.skipped++;
    if (outcome === "enrolled" || outcome === "duplicate") {
      await ctx.admin.from("event_registrations").update({ follow_up_started_at: now.toISOString() }).eq("id", reg.id).eq("tenant_id", ctx.tenantId);
    }
  }
  if (result.enrolled) {
    await logChange(ctx.supabase, { tenantId: ctx.tenantId, objectType: "marketing_events", objectId: eventId, objectLabel: event.ref ?? event.name, action: "update", actorId: ctx.userId, actorEmail: ctx.email, changes: [{ field: "follow_up_started", from: null, to: result.enrolled }] });
  }
  return result;
}
