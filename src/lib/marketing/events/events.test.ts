import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { fakeDb, type Row } from "@/lib/marketing/testFakeDb";
import type { ModuleCtx } from "@/lib/marketing/moduleAccess";
import { templateById } from "@/lib/marketing/journeys/definition";
import { canMove, cleanLink, localInputs, resultsOf, resultsSentence, sanitizeEvent, zonedToUtc } from "./rules";
import { eventsEnabled, registerFromSubmission, registerPerson } from "./register";
import { addRegistration, createEvent, deleteEvent, listAttendees, listEvents, loadEvent, loadResults, markRemainingNoShows, moveRegistration, saveEvent, startFollowUp } from "./server";

const T = "t1";
const U = "t2";
const F1 = "f1f1f1f1-0000-4000-8000-000000000001";
const F2 = "f2f2f2f2-0000-4000-8000-000000000002";
const FU = "fafafafa-0000-4000-8000-0000000000fa";
const J1 = "a1a1a1a1-0000-4000-8000-000000000001";
const JX = "a9a9a9a9-0000-4000-8000-000000000009";
const EV1 = "e1e1e1e1-0000-4000-8000-000000000001";
const EV2 = "e2e2e2e2-0000-4000-8000-000000000002";
const EVX = "e9e9e9e9-0000-4000-8000-000000000009";
const K1 = "c1c1c1c1-0000-4000-8000-000000000001";
const K2 = "c2c2c2c2-0000-4000-8000-000000000002";
const KX = "c9c9c9c9-0000-4000-8000-000000000009";
const U1 = "d1d1d1d1-0000-4000-8000-000000000001";
const PAST = new Date("2026-11-04T10:00:00Z");

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

function world(extra: Record<string, Row[]> = {}) {
  return fakeDb({
    tenants: [
      { id: T, name: "Al Noor", slug: "alnoor", custom_domain: null, company_info: null, features: { marketing: true, marketing_forms: true, marketing_events: true, journeys: true }, config: { wfm: { timezone: "Asia/Riyadh" } }, is_demo: false },
      { id: U, name: "Rival", slug: "rival", custom_domain: null, company_info: null, features: { marketing: true, marketing_forms: true, marketing_events: true, journeys: true }, config: {}, is_demo: false },
    ],
    accounts: [{ id: "a1", tenant_id: T, name: "Gulf Precast", owner_user_id: null }, { id: "a9", tenant_id: U, name: "Rival Co", owner_user_id: null }],
    contacts: [
      { id: K1, tenant_id: T, account_id: "a1", name: "Layla Hassan", email: null, created_at: "2026-01-01" },
      { id: K2, tenant_id: T, account_id: "a1", name: "Omar Aziz", email: null, created_at: "2026-02-01" },
      { id: KX, tenant_id: U, account_id: "a9", name: "Intruder", email: null, created_at: "2026-01-01" },
    ],
    forms: [{ id: F1, tenant_id: T, name: "Open day form", slug: "open-day", status: "live" }, { id: F2, tenant_id: T, name: "Other form", slug: "other", status: "live" }, { id: FU, tenant_id: U, name: "Rival form", slug: "rival", status: "live" }],
    journeys: [
      { id: J1, tenant_id: T, ref: "JNY-0001", name: "After an event", status: "live", definition: templateById("blank")!.build(), trigger_name: "quote.sent", version: 1, entry_from: null, went_live_at: null, created_at: "2026-10-01", updated_at: "2026-10-01" },
      { id: JX, tenant_id: U, ref: "JNY-0001", name: "Rival journey", status: "live", definition: templateById("blank")!.build(), trigger_name: "quote.sent", version: 1, entry_from: null, went_live_at: null, created_at: "2026-10-01", updated_at: "2026-10-01" },
    ],
    tenant_users: [{ tenant_id: T, user_id: U1, role: "admin" }],
    marketing_events: [
      { id: EV1, tenant_id: T, ref: "EVT-0001", name: "Open day", kind: "exhibition", status: "open", starts_at: "2026-11-03T07:00:00.000Z", ends_at: null, venue: "Riyadh", link: null, capacity: 2, description: null, form_id: F1, follow_up_journey_id: J1, follow_up_on: "attended", owner_user_id: U1, created_at: "2026-10-01", updated_at: "2026-10-01" },
      { id: EV2, tenant_id: T, ref: "EVT-0002", name: "Draft webinar", kind: "webinar", status: "draft", starts_at: "2026-12-03T07:00:00.000Z", ends_at: null, venue: null, link: null, capacity: null, description: null, form_id: F2, follow_up_journey_id: null, follow_up_on: "attended", owner_user_id: null, created_at: "2026-10-01", updated_at: "2026-10-01" },
      { id: EVX, tenant_id: U, ref: "EVT-0001", name: "Rival event", kind: "webinar", status: "open", starts_at: "2026-11-03T07:00:00.000Z", ends_at: null, venue: null, link: null, capacity: null, description: null, form_id: F1, follow_up_journey_id: null, follow_up_on: "attended", owner_user_id: null, created_at: "2026-10-01", updated_at: "2026-10-01" },
    ],
    event_registrations: [], domain_event: [], change_log: [], journey_runs: [], journey_cursors: [],
    ...extra,
  });
}

/** The fake database numbers rows "id-1"; the routes (rightly) insist on real uuids, so give the registrations some. */
const uuidIds = (db: ReturnType<typeof world>) => { db.tables.event_registrations.forEach((r, i) => { r.id = `0000000${i}-0000-4000-8000-00000000000${i}`; }); };

const ctxOf = (db: ReturnType<typeof world>, tenantId = T): ModuleCtx => ({
  supabase: db.client, admin: db.client, tenantId, userId: U1, role: "admin", email: "admin@alnoor.example",
  tenant: { name: "Al Noor", slug: "alnoor", isDemo: false, customDomain: null, config: {}, features: { marketing: true, marketing_forms: true, marketing_events: true }, timezone: "Asia/Riyadh" },
  can: { view: true, create: true, edit: true, delete: true },
} as unknown as ModuleCtx);

describe("the rules", () => {
  it("attendance is final; a no-show can turn up late; a cancelled person can register again", () => {
    expect(canMove("registered", "attended")).toBe(true);
    expect(canMove("registered", "no_show")).toBe(true);
    expect(canMove("registered", "cancelled")).toBe(true);
    expect(canMove("attended", "no_show")).toBe(false);
    expect(canMove("attended", "registered")).toBe(false);
    expect(canMove("attended", "cancelled")).toBe(false);
    expect(canMove("no_show", "attended")).toBe(true);
    expect(canMove("no_show", "registered")).toBe(false);
    expect(canMove("cancelled", "registered")).toBe(true);
    expect(canMove("cancelled", "attended")).toBe(false);
  });

  it("results: registered excludes the cancelled, and a show rate is only stated once there is something to divide", () => {
    expect(resultsOf([], 10)).toMatchObject({ registered: 0, showRate: null, over: 0 });
    expect(resultsOf(["registered", "registered", "cancelled"], null)).toMatchObject({ registered: 2, waiting: 2, cancelled: 1, showRate: null });
    const r = resultsOf(["attended", "attended", "attended", "no_show", "registered", "cancelled"], 4);
    expect(r).toMatchObject({ registered: 5, attended: 3, noShow: 1, waiting: 1, showRate: 75, over: 1 });
    expect(resultsSentence(r, false)).toContain("3 of 4 came (75%)");
    expect(resultsSentence(r, false)).toContain("1 not yet checked in");
    expect(resultsSentence(resultsOf(["registered"], null), false)).toContain("no show rate");
    expect(resultsSentence(resultsOf([], null), false)).toBe("Nobody has registered yet.");
  });

  it("the date and time are the workspace's wall clock", () => {
    expect(zonedToUtc("2026-11-03", "10:00", "Asia/Riyadh")?.toISOString()).toBe("2026-11-03T07:00:00.000Z");
    expect(zonedToUtc("2026-07-01", "10:00", "Europe/London")?.toISOString()).toBe("2026-07-01T09:00:00.000Z");
    expect(zonedToUtc("2026-02-30", "10:00", "Asia/Riyadh")).toBeNull();
    expect(zonedToUtc("2026-11-03", "25:00", "Asia/Riyadh")).toBeNull();
    expect(localInputs("2026-11-03T07:00:00.000Z", "Asia/Riyadh")).toEqual({ date: "2026-11-03", time: "10:00" });
    expect(localInputs(null, "Asia/Riyadh")).toEqual({ date: "", time: "" });
  });

  it("a save keeps only the closed shape; the link is https only; the end follows the start", () => {
    const ok = sanitizeEvent({ name: " Open day ", kind: "nonsense", status: "open", date: "2026-11-03", time: "10:00", end_time: "12:30", link: "https://meet.example.com/abc", capacity: "50", form_id: F1, follow_up_on: "no_show", owner_user_id: "nope", extra: 1 }, "Asia/Riyadh");
    expect(ok).toEqual({ ok: true, value: expect.objectContaining({ name: "Open day", kind: "webinar", status: "open", starts_at: "2026-11-03T07:00:00.000Z", ends_at: "2026-11-03T09:30:00.000Z", link: "https://meet.example.com/abc", capacity: 50, form_id: F1, follow_up_on: "no_show", owner_user_id: null }) });
    expect(sanitizeEvent({ name: "x", date: "2026-11-03", time: "10:00", end_time: "09:00" }, "Asia/Riyadh")).toMatchObject({ ok: false });
    expect(sanitizeEvent({ name: "x", date: "2026-11-03", time: "10:00", link: "javascript:alert(1)" }, "Asia/Riyadh")).toMatchObject({ ok: false });
    expect(sanitizeEvent({ name: "x", date: "2026-11-03", time: "10:00", capacity: "0" }, "Asia/Riyadh")).toMatchObject({ ok: false });
    expect(sanitizeEvent({ name: "", date: "2026-11-03", time: "10:00" }, "Asia/Riyadh")).toMatchObject({ ok: false });
    expect(sanitizeEvent({ name: "x", date: "", time: "10:00" }, "Asia/Riyadh")).toMatchObject({ ok: false });
    for (const bad of ["http://insecure.example.com", "data:text/html,hi", "https://user:pw@evil.example.com", "https://localhost"]) expect(cleanLink(bad), bad).toBeNull();
  });
});

describe("registering a person", () => {
  it("registers once, emits event.registered, and a second submission changes nothing", async () => {
    const db = world();
    const a = await registerPerson(db.client, T, { eventId: EV1, contactId: K1, source: "form", submissionId: "s1" });
    expect(a.status).toBe("registered");
    expect(db.tables.event_registrations[0]).toMatchObject({ tenant_id: T, event_id: EV1, contact_id: K1, account_id: "a1", status: "registered", source: "form", form_submission_id: "s1" });
    expect(db.tables.domain_event.map((e) => e.name)).toEqual(["event.registered"]);
    expect(db.tables.domain_event[0]).toMatchObject({ tenant_id: T, object_type: "marketing_event", object_id: EV1, contact_id: K1, source: "public_link" });

    const b = await registerPerson(db.client, T, { eventId: EV1, contactId: K1, source: "form" });
    expect(b.status).toBe("already");
    expect(db.tables.event_registrations).toHaveLength(1);
    expect(db.tables.domain_event).toHaveLength(1);
  });

  it("a cancelled person can register again, and a walk-in is registered and attended in one go", async () => {
    const db = world();
    await registerPerson(db.client, T, { eventId: EV1, contactId: K1, source: "form" });
    db.tables.event_registrations[0].status = "cancelled";
    expect((await registerPerson(db.client, T, { eventId: EV1, contactId: K1, source: "form" })).status).toBe("reregistered");
    expect(db.tables.event_registrations[0].status).toBe("registered");

    const walkIn = await registerPerson(db.client, T, { eventId: EV1, contactId: K2, source: "rep", actorId: U1, checkedIn: true });
    expect(walkIn.status).toBe("attended");
    expect(db.tables.event_registrations.find((r) => r.contact_id === K2)).toMatchObject({ status: "attended", source: "rep", checked_in_by: U1 });
    expect(db.tables.domain_event.filter((e) => e.contact_id === K2).map((e) => e.name).sort()).toEqual(["event.attended", "event.registered"]);
  });

  it("another workspace's contact or event is simply not found", async () => {
    const db = world();
    expect((await registerPerson(db.client, T, { eventId: EV1, contactId: KX, source: "rep" })).status).toBe("no_contact");
    expect((await registerPerson(db.client, T, { eventId: EVX, contactId: K1, source: "rep" })).status).toBe("no_event");
    expect(db.tables.event_registrations).toHaveLength(0);
    expect(db.tables.domain_event).toHaveLength(0);
  });

  it("only an OPEN event of this workspace whose form was submitted registers the person", async () => {
    const db = world();
    expect(await registerFromSubmission(db.client, T, { formId: F1, contactId: K1, submissionId: "s1" })).toBe(1);
    expect(db.tables.event_registrations.map((r) => r.event_id)).toEqual([EV1]);
    // the draft event's form registers nobody; the rival's event on the same form id is not this workspace's
    expect(await registerFromSubmission(db.client, T, { formId: F2, contactId: K2, submissionId: "s2" })).toBe(0);
    expect(db.tables.event_registrations.some((r) => r.tenant_id === U)).toBe(false);
    for (const q of db.queries.filter((x) => ["marketing_events", "event_registrations", "contacts"].includes(x.table) && x.op !== "insert" && x.op !== "upsert")) {
      expect(q.filters, `${q.op} ${q.table}`).toMatchObject({ tenant_id: T });
    }
  });

  it("the module needs all three flags", () => {
    expect(eventsEnabled({ marketing: true, marketing_forms: true, marketing_events: true })).toBe(true);
    expect(eventsEnabled({ marketing: true, marketing_events: true })).toBe(false);
    expect(eventsEnabled({ marketing: true, marketing_forms: true })).toBe(false);
    expect(eventsEnabled({ marketing_forms: true, marketing_events: true })).toBe(false);
    expect(eventsEnabled(null)).toBe(false);
  });

  it("a missing table (migration pending) does not crash the form", async () => {
    const seed = world();
    const db = fakeDb({ marketing_events: seed.tables.marketing_events }, { missingTables: ["event_registrations"] });
    expect(await registerFromSubmission(db.client, T, { formId: F1, contactId: K1, submissionId: "s" })).toBe(0);
    const none = fakeDb({}, { missingTables: ["marketing_events"] });
    expect(await registerFromSubmission(none.client, T, { formId: F1, contactId: K1, submissionId: "s" })).toBe(0);
  });
});

describe("check-in and no-shows", () => {
  async function registered() {
    const db = world();
    await registerPerson(db.client, T, { eventId: EV1, contactId: K1, source: "form" });
    await registerPerson(db.client, T, { eventId: EV1, contactId: K2, source: "form" });
    uuidIds(db);
    db.tables.domain_event.length = 0;
    return db;
  }

  it("checking in records the time and who, emits event.attended once, and writes the audit trail", async () => {
    const db = await registered();
    const reg = db.tables.event_registrations[0];
    expect(await moveRegistration(ctxOf(db), EV1, reg.id as string, "attended")).toEqual({ status: "attended" });
    expect(reg).toMatchObject({ status: "attended", checked_in_by: U1 });
    expect(reg.checked_in_at).toBeTruthy();
    expect(db.tables.domain_event.map((e) => e.name)).toEqual(["event.attended"]);
    expect(db.tables.change_log.at(-1)).toMatchObject({ object_type: "event_registrations", action: "update", tenant_id: T });
    // pressing it again is a no-op, not a second event
    await moveRegistration(ctxOf(db), EV1, reg.id as string, "attended");
    expect(db.tables.domain_event).toHaveLength(1);
  });

  it("attendance is final (409), a no-show can still turn up, a bad status is refused", async () => {
    const db = await registered();
    const [a, b] = db.tables.event_registrations;
    await moveRegistration(ctxOf(db), EV1, a.id as string, "attended");
    await expect(moveRegistration(ctxOf(db), EV1, a.id as string, "no_show")).rejects.toMatchObject({ status: 409 });
    await moveRegistration(ctxOf(db), EV1, b.id as string, "no_show");
    expect(await moveRegistration(ctxOf(db), EV1, b.id as string, "attended")).toEqual({ status: "attended" });
    await expect(moveRegistration(ctxOf(db), EV1, b.id as string, "nonsense")).rejects.toMatchObject({ status: 422 });
  });

  it("another workspace's registration, or one from another event, is not found", async () => {
    const db = await registered();
    db.tables.event_registrations.push({ id: "00000009-0000-4000-8000-000000000009", tenant_id: U, event_id: EV1, contact_id: KX, account_id: "a9", status: "registered" });
    await expect(moveRegistration(ctxOf(db), EV1, "00000009-0000-4000-8000-000000000009", "attended")).rejects.toMatchObject({ status: 404 });
    await expect(moveRegistration(ctxOf(db), EV2, db.tables.event_registrations[0].id as string, "attended")).rejects.toMatchObject({ status: 404 });
    expect(db.tables.event_registrations.find((r) => r.id === "00000009-0000-4000-8000-000000000009")!.status).toBe("registered");
  });

  it("marking the rest as not coming is refused before the event, then marks only those still registered, once", async () => {
    const db = await registered();
    await expect(markRemainingNoShows(ctxOf(db), EV1, new Date("2026-11-02T00:00:00Z"))).rejects.toMatchObject({ status: 409 });
    await moveRegistration(ctxOf(db), EV1, db.tables.event_registrations[0].id as string, "attended");
    db.tables.domain_event.length = 0;
    expect(await markRemainingNoShows(ctxOf(db), EV1, PAST)).toEqual({ marked: 1 });
    expect(db.tables.event_registrations.map((r) => r.status).sort()).toEqual(["attended", "no_show"]);
    expect(db.tables.domain_event.map((e) => e.name)).toEqual(["event.no_show"]);
    expect(await markRemainingNoShows(ctxOf(db), EV1, PAST)).toEqual({ marked: 0 });
    expect(db.tables.domain_event).toHaveLength(1);
  });

  it("the results panel counts what happened", async () => {
    const db = await registered();
    await moveRegistration(ctxOf(db), EV1, db.tables.event_registrations[0].id as string, "attended");
    await markRemainingNoShows(ctxOf(db), EV1, PAST);
    const r = await loadResults(ctxOf(db), { id: EV1, capacity: 2 });
    expect(r).toMatchObject({ registered: 2, attended: 1, noShow: 1, showRate: 50, over: 0 });
  });

  it("the attendee list shows a name, a company and a status, never a phone or an email", async () => {
    const db = await registered();
    const l = await listAttendees(ctxOf(db), EV1);
    expect(l.total).toBe(2);
    expect(l.rows.map((r) => r.name).sort()).toEqual(["Layla Hassan", "Omar Aziz"]);
    expect(Object.keys(l.rows[0]).join(",")).not.toMatch(/phone|email/i);
    expect(l.rows[0].company).toBe("Gulf Precast");
  });

  it("a rep can add a walk-in only to this workspace's event, and not to a cancelled one", async () => {
    const db = world();
    expect(await addRegistration(ctxOf(db), EV1, K2, true)).toMatchObject({ status: "attended" });
    await expect(addRegistration(ctxOf(db), EV1, "not-a-uuid", false)).rejects.toMatchObject({ status: 422 });
    await expect(addRegistration(ctxOf(db), EVX, K1, false)).rejects.toMatchObject({ status: 404 });
    db.tables.marketing_events[0].status = "cancelled";
    await expect(addRegistration(ctxOf(db), EV1, K1, false)).rejects.toMatchObject({ status: 409 });
  });
});

describe("the follow-up", () => {
  async function attended() {
    const db = world();
    await registerPerson(db.client, T, { eventId: EV1, contactId: K1, source: "form" });
    await registerPerson(db.client, T, { eventId: EV1, contactId: K2, source: "form" });
    uuidIds(db);
    await moveRegistration(ctxOf(db), EV1, db.tables.event_registrations[0].id as string, "attended");
    return db;
  }

  it("starts the chosen journey for the people who came, once each, through the runner's own enrolment", async () => {
    const db = await attended();
    const r = await startFollowUp(ctxOf(db), EV1, PAST);
    expect(r).toEqual({ enrolled: 1, already: 0, skipped: 0 });
    expect(db.tables.journey_runs).toHaveLength(1);
    expect(db.tables.journey_runs[0]).toMatchObject({ tenant_id: T, journey_id: J1, trigger_event_name: "event.attended", contact_id: K1 });
    expect(db.tables.event_registrations[0].follow_up_started_at).toBeTruthy();
    expect(db.tables.event_registrations[1].follow_up_started_at).toBeFalsy();

    const again = await startFollowUp(ctxOf(db), EV1, PAST);
    expect(again).toEqual({ enrolled: 0, already: 1, skipped: 0 });
    expect(db.tables.journey_runs).toHaveLength(1);
  });

  it("for no-shows when the event says so", async () => {
    const db = await attended();
    db.tables.marketing_events[0].follow_up_on = "no_show";
    await markRemainingNoShows(ctxOf(db), EV1, PAST);
    const r = await startFollowUp(ctxOf(db), EV1, PAST);
    expect(r.enrolled).toBe(1);
    expect(db.tables.journey_runs[0]).toMatchObject({ contact_id: K2, trigger_event_name: "event.no_show" });
  });

  it("needs a journey that exists in this workspace and is running", async () => {
    const db = await attended();
    db.tables.marketing_events[0].follow_up_journey_id = null;
    await expect(startFollowUp(ctxOf(db), EV1, PAST)).rejects.toMatchObject({ status: 422 });
    db.tables.marketing_events[0].follow_up_journey_id = JX; // another workspace's journey
    await expect(startFollowUp(ctxOf(db), EV1, PAST)).rejects.toMatchObject({ status: 422 });
    db.tables.marketing_events[0].follow_up_journey_id = J1;
    db.tables.journeys[0].status = "paused";
    await expect(startFollowUp(ctxOf(db), EV1, PAST)).rejects.toMatchObject({ status: 409 });
    expect(db.tables.journey_runs).toHaveLength(0);
  });

  it("builds no automation of its own: it writes runs through the journey, and sends nothing", async () => {
    const db = await attended();
    await startFollowUp(ctxOf(db), EV1, PAST);
    const writes = new Set(db.queries.filter((q) => q.op !== "select").map((q) => q.table));
    for (const t of writes) expect(["event_registrations", "journey_runs", "domain_event", "change_log"], t).toContain(t);
  });
});

describe("saving an event", () => {
  const body = (over: Record<string, unknown> = {}) => ({ name: "Roadshow", kind: "roadshow", status: "draft", date: "2026-12-10", time: "09:00", ...over });

  it("creates a draft with a reference, defaults the owner to the creator, and writes change history", async () => {
    const db = world();
    const r = await createEvent(ctxOf(db), body());
    expect(r).toMatchObject({ ref: "EVT-0003" });
    const row = db.tables.marketing_events.at(-1)!;
    expect(row).toMatchObject({ tenant_id: T, name: "Roadshow", starts_at: "2026-12-10T06:00:00.000Z", owner_user_id: U1, status: "draft", created_by: U1 });
    expect(db.tables.change_log.at(-1)).toMatchObject({ object_type: "marketing_events", action: "create" });
  });

  it("refuses another workspace's form, journey or colleague, and a form that already registers for a running event", async () => {
    const db = world();
    await expect(createEvent(ctxOf(db), body({ form_id: FU }))).rejects.toMatchObject({ status: 422 });
    await expect(createEvent(ctxOf(db), body({ follow_up_journey_id: JX }))).rejects.toMatchObject({ status: 422 });
    await expect(createEvent(ctxOf(db), body({ owner_user_id: "d9d9d9d9-0000-4000-8000-000000000009" }))).rejects.toMatchObject({ status: 422 });
    await expect(createEvent(ctxOf(db), body({ form_id: F1 }))).rejects.toMatchObject({ status: 409 });
    // the same form on the event it already belongs to is fine
    await expect(saveEvent(ctxOf(db), EV1, body({ form_id: F1, status: "open", date: "2026-11-03", time: "10:00" }))).resolves.toEqual({ ok: true });
  });

  it("a status-only save (Open registration, Cancel) changes only the status", async () => {
    const db = world();
    await saveEvent(ctxOf(db), EV2, { status: "open" });
    expect(db.tables.marketing_events.find((e) => e.id === EV2)).toMatchObject({ status: "open", name: "Draft webinar", form_id: F2 });
    await expect(saveEvent(ctxOf(db), EV2, { status: "bogus" })).rejects.toMatchObject({ status: 422 });
    expect(db.tables.change_log.at(-1)).toMatchObject({ object_type: "marketing_events", changes: [{ field: "status", from: "draft", to: "open" }] });
  });

  it("another workspace's event reads like a missing one and cannot be saved or deleted", async () => {
    const db = world();
    expect((await loadEvent(ctxOf(db), EVX)).data).toBeNull();
    await expect(saveEvent(ctxOf(db), EVX, body())).rejects.toMatchObject({ status: 404 });
    expect(await deleteEvent(ctxOf(db), EVX)).toBe("not_found");
    expect(db.tables.marketing_events.find((e) => e.id === EVX)).toMatchObject({ name: "Rival event" });
  });

  it("an event people registered for is cancelled, not deleted", async () => {
    const db = world();
    await registerPerson(db.client, T, { eventId: EV1, contactId: K1, source: "form" });
    expect(await deleteEvent(ctxOf(db), EV1)).toBe("cancelled");
    expect(db.tables.marketing_events.find((e) => e.id === EV1)!.status).toBe("cancelled");
    expect(await deleteEvent(ctxOf(db), EV2)).toBe("deleted");
    expect(db.tables.marketing_events.some((e) => e.id === EV2)).toBe(false);
  });

  it("the list is this workspace's only, with registered and came counts", async () => {
    const db = world();
    await registerPerson(db.client, T, { eventId: EV1, contactId: K1, source: "form" });
    uuidIds(db);
    await moveRegistration(ctxOf(db), EV1, db.tables.event_registrations[0].id as string, "attended");
    const l = await listEvents(ctxOf(db), { q: "", status: null, page: 1, page_size: 20 });
    expect(l.rows.map((e) => e.id).sort()).toEqual([EV1, EV2].sort());
    expect(l.rows.find((e) => e.id === EV1)).toMatchObject({ registered: 1, attended: 1 });
  });
});
