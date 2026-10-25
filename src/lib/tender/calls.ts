// GCC tender deals, slice 4: calls and other contacts logged against a deal, each with an optional next step. PURE: field checks and
// the "overdue" rule, shared by the routes, the screen and the tests.

export const CALL_KINDS = ["call", "meeting", "site_visit", "note"] as const;
export type CallKind = (typeof CALL_KINDS)[number];
export const CALL_KIND_LABEL: Record<CallKind, string> = { call: "Call", meeting: "Meeting", site_visit: "Site visit", note: "Note" };

export const CALL_LIMITS = {
  summaryMax: 2000, withMax: 200, outcomeMax: 500, nextStepMax: 300,
  /** Entries one deal can hold: a guard against a runaway script, far above real use. */
  perDeal: 1000,
  /** How far ahead of now a contact may be dated (a call logged just before midnight in another zone). */
  futureHours: 24,
  /** Shown on the Activity tab before "Show all". */
  shown: 5,
} as const;

export type CallFields = {
  kind: CallKind;
  occurred_at: string;
  with_whom: string | null;
  summary: string;
  outcome: string | null;
  next_step: string | null;
  next_step_due: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** A real calendar day in yyyy-mm-dd form. */
export function isDayKey(v: unknown): v is string {
  if (typeof v !== "string" || !DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** A new entry. Anything not on the allow-list (the logger, the tenant, the done stamp) is ignored. */
export function parseNewCall(body: unknown, now: Date): Parsed<CallFields> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const kind = b.kind === undefined || b.kind === "" ? "call" : b.kind;
  if (!(CALL_KINDS as readonly unknown[]).includes(kind)) return { ok: false, error: "kind must be call, meeting, site_visit or note" };
  const summary = text(b.summary);
  if (!summary) return { ok: false, error: "Say what was discussed" };
  if (summary.length > CALL_LIMITS.summaryMax) return { ok: false, error: `The summary is too long (${CALL_LIMITS.summaryMax} characters at most)` };
  const common = parseCommon(b, now);
  if (!common.ok) return common;
  return { ok: true, value: { kind: kind as CallKind, occurred_at: common.value.occurred_at ?? now.toISOString(), with_whom: common.value.with_whom ?? null, summary, outcome: common.value.outcome ?? null, next_step: common.value.next_step ?? null, next_step_due: common.value.next_step_due ?? null } };
}

/** The fields an edit may change. Only keys present in the body are returned. */
export function parseCallEdit(body: unknown, now: Date): Parsed<Partial<CallFields> & { next_step_done?: boolean }> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: Partial<CallFields> & { next_step_done?: boolean } = {};
  if ("kind" in b) {
    if (!(CALL_KINDS as readonly unknown[]).includes(b.kind)) return { ok: false, error: "kind must be call, meeting, site_visit or note" };
    out.kind = b.kind as CallKind;
  }
  if ("summary" in b) {
    const s = text(b.summary);
    if (!s) return { ok: false, error: "Say what was discussed" };
    if (s.length > CALL_LIMITS.summaryMax) return { ok: false, error: `The summary is too long (${CALL_LIMITS.summaryMax} characters at most)` };
    out.summary = s;
  }
  const common = parseCommon(b, now);
  if (!common.ok) return common;
  Object.assign(out, common.value);
  if ("next_step_done" in b) out.next_step_done = b.next_step_done === true;
  if (Object.keys(out).length === 0) return { ok: false, error: "Nothing to change" };
  return { ok: true, value: out };
}

function parseCommon(b: Record<string, unknown>, now: Date): Parsed<Partial<Omit<CallFields, "kind" | "summary">>> {
  const out: Partial<Omit<CallFields, "kind" | "summary">> = {};
  if ("occurred_at" in b && b.occurred_at !== "" && b.occurred_at !== null) {
    const raw = text(b.occurred_at);
    const t = Date.parse(DAY.test(raw) ? `${raw}T12:00:00Z` : raw);
    if (!raw || Number.isNaN(t)) return { ok: false, error: "occurred_at is not a date" };
    if (t > now.getTime() + CALL_LIMITS.futureHours * 3_600_000) return { ok: false, error: "A contact cannot be dated in the future" };
    if (t < Date.UTC(2000, 0, 1)) return { ok: false, error: "occurred_at is too far back" };
    out.occurred_at = new Date(t).toISOString();
  }
  for (const [key, max, label] of [["with_whom", CALL_LIMITS.withMax, "Who"], ["outcome", CALL_LIMITS.outcomeMax, "The outcome"], ["next_step", CALL_LIMITS.nextStepMax, "The next step"]] as const) {
    if (!(key in b)) continue;
    const s = text(b[key]);
    if (s.length > max) return { ok: false, error: `${label} is too long (${max} characters at most)` };
    out[key] = s || null;
  }
  if ("next_step_due" in b) {
    if (b.next_step_due === null || b.next_step_due === "") out.next_step_due = null;
    else if (!isDayKey(b.next_step_due)) return { ok: false, error: "next_step_due must be YYYY-MM-DD" };
    else out.next_step_due = b.next_step_due;
  }
  return { ok: true, value: out };
}

/** After merging an edit onto the stored entry: a due date needs a next step to be due. */
export function nextStepProblem(merged: { next_step: string | null; next_step_due: string | null }): string | null {
  return merged.next_step_due && !merged.next_step ? "Add the next step the date belongs to" : null;
}

// ── Overdue ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type CallView = {
  id: string;
  kind: CallKind;
  occurred_at: string;
  with_whom: string | null;
  summary: string;
  outcome: string | null;
  next_step: string | null;
  next_step_due: string | null;
  next_step_done_at: string | null;
  logged_by_name: string | null;
  /** The caller logged it (or is an admin): may edit and delete. */
  can_change: boolean;
};

export type CallsData = {
  /** Newest first. */
  calls: CallView[];
  /** 0225 has not been applied yet. */
  pending: boolean;
  canEdit: boolean;
};

/** A next step with a due date before today that nobody ticked off. `todayKey` is the workspace's own today. */
export function isOverdue(c: { next_step: string | null; next_step_due: string | null; next_step_done_at: string | null }, todayKey: string): boolean {
  return !!c.next_step && !!c.next_step_due && !c.next_step_done_at && c.next_step_due < todayKey;
}

export type OverdueSummary = { count: number; oldest_due: string | null; first: string | null };

/** How many next steps are overdue, the oldest due date, and the text of the oldest one (for the chip's tooltip). */
export function overdueSummary(calls: readonly { next_step: string | null; next_step_due: string | null; next_step_done_at: string | null }[], todayKey: string): OverdueSummary {
  const late = calls.filter((c) => isOverdue(c, todayKey)).sort((a, b) => (a.next_step_due as string).localeCompare(b.next_step_due as string));
  return { count: late.length, oldest_due: late[0]?.next_step_due ?? null, first: late[0]?.next_step ?? null };
}

/** Newest first, by when the contact happened. */
export function newestFirst<T extends { occurred_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}
