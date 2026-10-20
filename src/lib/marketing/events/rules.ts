// Marketing events: vocabulary, validation, status moves and the results arithmetic. Pure (importable from client
// components): nothing here touches a database or a clock.

export const EVENT_KINDS = ["webinar", "exhibition", "roadshow", "site_visit"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const KIND_LABEL: Record<EventKind, string> = { webinar: "Webinar", exhibition: "Exhibition", roadshow: "Roadshow", site_visit: "Site visit" };
export const KIND_HINT: Record<EventKind, string> = {
  webinar: "Online. People get a link to join.",
  exhibition: "A trade show or stand. People are met at a venue.",
  roadshow: "You travel to several places or customers.",
  site_visit: "A visit to your factory, a project or a customer site.",
};

export const EVENT_STATUSES = ["draft", "open", "closed", "completed", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];
export const STATUS_LABEL: Record<EventStatus, string> = { draft: "Draft", open: "Registration open", closed: "Registration closed", completed: "Completed", cancelled: "Cancelled" };
export const STATUS_HINT: Record<EventStatus, string> = {
  draft: "Not announced yet. A form linked to it does not register anyone.",
  open: "People who fill in the linked form are registered.",
  closed: "No new registrations from the form. Staff can still add people.",
  completed: "It has happened. Check-in is closed in the sense that you can still correct it.",
  cancelled: "It will not happen.",
};

export const REGISTRATION_STATUSES = ["registered", "attended", "no_show", "cancelled"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];
export const REG_LABEL: Record<RegistrationStatus, string> = { registered: "Registered", attended: "Attended", no_show: "Did not come", cancelled: "Cancelled" };

/**
 * Where a registration may move. Attendance is final once recorded: events, journeys and revenue reports have
 * already seen `event.attended`, and taking it back would make the stream lie. A person marked as not coming can
 * still turn up late; a cancelled person can register again.
 */
const MOVES: Record<RegistrationStatus, RegistrationStatus[]> = {
  registered: ["attended", "no_show", "cancelled"],
  attended: [],
  no_show: ["attended"],
  cancelled: ["registered"],
};
export const canMove = (from: RegistrationStatus, to: RegistrationStatus): boolean => MOVES[from].includes(to);

export type FollowUpOn = "attended" | "no_show";
export const FOLLOW_UP_LABEL: Record<FollowUpOn, string> = { attended: "People who came", no_show: "People who did not come" };

export const LIMITS = { name: 100, venue: 160, link: 300, description: 1000, capacity: 100_000 } as const;

// ── time zones ───────────────────────────────────────────────────────────────

function offsetMs(tz: string, at: Date): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at).map((p) => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - at.getTime();
}

/** The UTC instant of a wall-clock date ("2026-11-03") and time ("10:00") in a time zone, or null if they are not real. */
export function zonedToUtc(date: string, time: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const naive = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(naive.getTime()) || naive.toISOString().slice(0, 10) !== date) return null;
  try {
    const first = new Date(naive.getTime() - offsetMs(tz, naive));
    return new Date(naive.getTime() - offsetMs(tz, first));
  } catch {
    return null;
  }
}

/** The wall-clock date and time of an instant in a time zone, for the edit form. */
export function localInputs(iso: string | null | undefined, tz: string): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  } catch {
    return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16) };
  }
}

// ── validation ───────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]+/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, max) : "");

export type EventSave = {
  name: string;
  kind: EventKind;
  status: EventStatus;
  starts_at: string;
  ends_at: string | null;
  venue: string | null;
  link: string | null;
  capacity: number | null;
  description: string | null;
  form_id: string | null;
  follow_up_journey_id: string | null;
  follow_up_on: FollowUpOn;
  owner_user_id: string | null;
};

/** An https link and nothing else: it is shown to staff and may be put in an email, so no javascript: or data: address. */
export function cleanLink(raw: unknown): string | null {
  const s = text(raw, LIMITS.link);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || !u.hostname.includes(".") || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** The closed shape an event save must have. Unknown keys are dropped; bad values are errors, never guesses. */
export function sanitizeEvent(input: unknown, timezone: string): { ok: true; value: EventSave } | { ok: false; error: string } {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const name = text(o.name, LIMITS.name);
  if (!name) return { ok: false, error: "Give the event a name." };
  const kind = (EVENT_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as EventKind) : "webinar";
  const status = (EVENT_STATUSES as readonly string[]).includes(o.status as string) ? (o.status as EventStatus) : "draft";
  const date = typeof o.date === "string" ? o.date : "";
  const time = typeof o.time === "string" && o.time ? o.time : "09:00";
  const start = zonedToUtc(date, time, timezone);
  if (!start) return { ok: false, error: "Choose the date and the start time." };
  let end: Date | null = null;
  if (typeof o.end_time === "string" && o.end_time) {
    end = zonedToUtc(date, o.end_time, timezone);
    if (!end) return { ok: false, error: "The end time is not a time." };
    if (end.getTime() <= start.getTime()) return { ok: false, error: "The end must be after the start." };
  }
  let link: string | null = null;
  if (typeof o.link === "string" && o.link.trim()) {
    link = cleanLink(o.link);
    if (!link) return { ok: false, error: "The link must be a full https address, for example https://meet.example.com/abc." };
  }
  let capacity: number | null = null;
  if (o.capacity !== null && o.capacity !== undefined && o.capacity !== "") {
    const n = Number(o.capacity);
    if (!Number.isInteger(n) || n < 1 || n > LIMITS.capacity) return { ok: false, error: "Capacity is a whole number of people, or leave it empty." };
    capacity = n;
  }
  const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : null);
  return {
    ok: true,
    value: {
      name, kind, status, starts_at: start.toISOString(), ends_at: end ? end.toISOString() : null,
      venue: text(o.venue, LIMITS.venue) || null, link, capacity, description: text(o.description, LIMITS.description) || null,
      form_id: id(o.form_id), follow_up_journey_id: id(o.follow_up_journey_id),
      follow_up_on: o.follow_up_on === "no_show" ? "no_show" : "attended", owner_user_id: id(o.owner_user_id),
    },
  };
}

// ── results ──────────────────────────────────────────────────────────────────

export type Results = {
  registered: number;
  attended: number;
  noShow: number;
  cancelled: number;
  waiting: number;
  capacity: number | null;
  /** attended / (attended + did not come). Null until someone has been checked in or marked as not coming. */
  showRate: number | null;
  /** Registered beyond capacity (0 when no capacity is set). */
  over: number;
};

/** Registered counts everyone who did not cancel. Show rate is only stated once there is something to divide. */
export function resultsOf(statuses: RegistrationStatus[], capacity: number | null): Results {
  const n = (s: RegistrationStatus) => statuses.filter((x) => x === s).length;
  const attended = n("attended");
  const noShow = n("no_show");
  const cancelled = n("cancelled");
  const registered = statuses.length - cancelled;
  const decided = attended + noShow;
  return {
    registered, attended, noShow, cancelled, waiting: n("registered"), capacity,
    showRate: decided > 0 ? Math.round((attended / decided) * 100) : null,
    over: capacity !== null ? Math.max(0, registered - capacity) : 0,
  };
}

/** The sentence under the results: what the numbers mean, and what they are not yet. */
export function resultsSentence(r: Results, over: boolean): string {
  if (r.registered === 0) return "Nobody has registered yet.";
  if (r.showRate === null) return `${r.registered} registered. Nobody has been checked in yet, so there is no show rate.`;
  const base = `${r.attended} of ${r.attended + r.noShow} came (${r.showRate}%).`;
  if (r.waiting > 0 && !over) return `${base} ${r.waiting} not yet checked in, so this may rise.`;
  if (r.waiting > 0) return `${base} ${r.waiting} registered people were not marked either way and are left out.`;
  return base;
}
