import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { readinessProblems, sanitizeJourney, templateById, TRIGGERS, dayOffsets, fillTaskText } from "./definition";
import { explainEntry, explainStep } from "./explain";
import { shouldEnrol, subjectKey, matchesCondition, type EventLike } from "./rules";
import { DEFAULT_LIMITS, backoffMs, capCheck, inTrouble, isOverdueByTicks, limitsOf, timingCheck } from "./safety";
import { reasonGroup, reasonLabel } from "./reasons";
import { buildGoLiveChecks } from "./preview";
import { classifyRun } from "./activity";
import type { JourneyRow } from "./types";

const quote = () => templateById("quote_follow_up")!.build();

describe("the definition", () => {
  it("the Quote follow-up template is wait 3 days, send, task, and starts from quote.sent on a Standard Quote", () => {
    const d = quote();
    expect(d.trigger.event).toBe("quote.sent");
    expect(d.trigger.condition).toEqual({ field: "object_type", op: "eq", value: "standard_quote" });
    expect(d.steps.map((s) => s.kind)).toEqual(["wait", "send_newsletter", "create_task"]);
    expect(sanitizeJourney(d).ok).toBe(true);
  });

  it("refuses an unknown event, an event that is not offered, and journey/email events (a journey cannot start from itself)", () => {
    for (const event of ["nope.nothing", "journey.entered", "email.sent", "campaign.sent"]) {
      const r = sanitizeJourney({ ...quote(), trigger: { event, condition: null } });
      expect(r.ok, event).toBe(false);
    }
    expect(TRIGGERS.every((t) => !t.event.startsWith("journey.") && !t.event.startsWith("email."))).toBe(true);
  });

  it("drops unknown keys, clamps numbers, and refuses a free-form condition field", () => {
    const r = sanitizeJourney({
      version: 9, evil: true, trigger: { event: "quote.sent", condition: { field: "payload.__proto__.x; drop", op: "eq", value: 1 } },
      entry: { lookback_days: 9999, one_per_account: "nope" },
      steps: [{ id: "a", kind: "wait", amount: 5000, unit: "days", extra: 1 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.definition.trigger.condition).toBeNull();
      expect(r.definition.entry.lookback_days).toBe(30);
      expect(r.definition.entry.one_per_account).toBe(true);
      expect(r.definition.steps[0]).toEqual({ id: "a", kind: "wait", amount: 90, unit: "days" });
      expect(JSON.stringify(r.definition)).not.toContain("evil");
    }
  });

  it("refuses more than twelve steps and a step of a kind that does not exist", () => {
    const steps = Array.from({ length: 13 }, () => ({ kind: "end" }));
    expect(sanitizeJourney({ trigger: { event: "quote.sent" }, steps }).ok).toBe(false);
    expect(sanitizeJourney({ trigger: { event: "quote.sent" }, steps: [{ kind: "branch" }] }).ok).toBe(false);
  });

  it("is not ready to turn on without steps or without a chosen newsletter version", () => {
    expect(readinessProblems({ ...quote(), steps: [] })[0]).toMatch(/at least one step/);
    expect(readinessProblems(quote()).join(" ")).toMatch(/Step 2: choose which newsletter/);
  });

  it("counts days only through waits", () => {
    expect(dayOffsets(quote().steps)).toEqual([0, 3, 3]);
  });

  it("fills the task words", () => {
    expect(fillTaskText("Call {contact_name} about quote {quote_ref}", { contact_name: "Layla", quote_ref: "SQ-0042" })).toBe("Call Layla about quote SQ-0042");
  });
});

const ev = (over: Partial<EventLike> = {}): EventLike => ({
  id: "e1", name: "quote.sent", object_type: "standard_quote", object_id: "q1", contact_id: "c1", account_id: "a1", campaign_id: null,
  source: "app", depth: 0, payload: { ref: "SQ-1", total: 60000 }, created_at: "2026-10-20T10:00:00.000Z", ...over,
});
const j = (over: Partial<JourneyRow> = {}): Pick<JourneyRow, "id" | "status" | "trigger_name" | "entry_from" | "definition"> =>
  ({ id: "j1", status: "live", trigger_name: "quote.sent", entry_from: "2026-10-19T00:00:00.000Z", definition: quote(), ...over });

describe("who enters", () => {
  it("enrols a matching event once the journey is live and the event is after its start", () => {
    expect(shouldEnrol(j(), ev()).ok).toBe(true);
    expect(shouldEnrol(j({ status: "paused" }), ev())).toEqual({ ok: false, reason: "not_live" });
    expect(shouldEnrol(j({ entry_from: "2026-10-21T00:00:00.000Z" }), ev())).toEqual({ ok: false, reason: "before_start" });
    expect(shouldEnrol(j(), ev({ name: "quote.accepted" }))).toEqual({ ok: false, reason: "other_event" });
  });

  it("applies the simple condition: only a Standard Quote, and an amount", () => {
    expect(shouldEnrol(j(), ev({ object_type: "quote" }))).toEqual({ ok: false, reason: "condition_not_met" });
    expect(matchesCondition({ field: "payload.total", op: "gte", value: 50000 }, ev())).toBe(true);
    expect(matchesCondition({ field: "payload.total", op: "gte", value: 70000 }, ev())).toBe(false);
    expect(matchesCondition({ field: "payload.missing", op: "gte", value: 1 }, ev())).toBe(false);
  });

  it("loop guard: too deep an event, an event from the journey itself, or from its own send campaign never enrols", () => {
    expect(shouldEnrol(j(), ev({ depth: 3 }))).toEqual({ ok: false, reason: "loop_guard" });
    expect(shouldEnrol(j(), ev({ object_id: "j1" }))).toEqual({ ok: false, reason: "own_event" });
    expect(shouldEnrol(j(), ev({ campaign_id: "camp1" }), new Set(["camp1"]))).toEqual({ ok: false, reason: "own_event" });
  });

  it("one person per company when asked, otherwise per person; nobody named is nobody", () => {
    expect(subjectKey(true, "c1", "a1")).toBe("a:a1");
    expect(subjectKey(false, "c1", "a1")).toBe("c:c1");
    expect(subjectKey(false, null, "a1")).toBe("a:a1");
    expect(subjectKey(true, null, null)).toBeNull();
  });
});

// Wednesday 21 Oct 2026 07:00Z = 10:00 in Riyadh. Friday 23 Oct 09:00Z = 12:00 Riyadh.
const TZ = "Asia/Riyadh";
describe("quiet hours, the weekly day off, the cap and trouble", () => {
  it("allows a Wednesday morning", () => {
    expect(timingCheck(new Date("2026-10-21T07:00:00Z"), TZ, DEFAULT_LIMITS).ok).toBe(true);
  });
  it("holds a send at 21:00 local until 08:00 the next allowed morning", () => {
    const r = timingCheck(new Date("2026-10-21T18:00:00Z"), TZ, DEFAULT_LIMITS);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe("quiet_hours"); expect(r.resumeAt.toISOString()).toBe("2026-10-22T05:00:00.000Z"); }
  });
  it("holds a Friday (the Saudi day off) until Saturday 08:00, never skips it", () => {
    const r = timingCheck(new Date("2026-10-23T09:00:00Z"), TZ, DEFAULT_LIMITS);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe("weekly_off"); expect(r.resumeAt.toISOString()).toBe("2026-10-24T05:00:00.000Z"); }
  });
  it("a workspace that works Fridays clears the day off in its settings", () => {
    const l = limitsOf({ marketing: { journey_limits: { off_weekdays: [] } } });
    expect(timingCheck(new Date("2026-10-23T09:00:00Z"), TZ, l).ok).toBe(true);
  });
  it("one journey email a day: a second waits until 24 hours after the first", () => {
    const now = new Date("2026-10-21T07:00:00Z");
    const first = new Date("2026-10-21T04:00:00Z");
    const r = capCheck(now, [first], DEFAULT_LIMITS);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.resumeAt.getTime()).toBeGreaterThan(first.getTime() + 86_400_000);
    expect(capCheck(now, [new Date("2026-10-19T04:00:00Z")], DEFAULT_LIMITS).ok).toBe(true);
  });
  it("trouble: an overdue invoice, or a case open longer than the limit", () => {
    const now = new Date("2026-10-21T07:00:00Z");
    expect(inTrouble(now, { oldestOpenCaseAt: null, hasOverdueInvoice: true }, DEFAULT_LIMITS)).toBe(true);
    expect(inTrouble(now, { oldestOpenCaseAt: new Date("2026-09-01T00:00:00Z"), hasOverdueInvoice: false }, DEFAULT_LIMITS)).toBe(true);
    expect(inTrouble(now, { oldestOpenCaseAt: new Date("2026-10-15T00:00:00Z"), hasOverdueInvoice: false }, DEFAULT_LIMITS)).toBe(false);
  });
  it("backs off 5, 20, 45 minutes", () => {
    expect([1, 2, 3].map(backoffMs)).toEqual([300_000, 1_200_000, 2_700_000]);
  });
  it("a run is overdue after more than two ticks", () => {
    const now = new Date("2026-10-21T07:30:00Z");
    expect(isOverdueByTicks("2026-10-21T07:15:00Z", now)).toBe(true);
    expect(isOverdueByTicks("2026-10-21T07:25:00Z", now)).toBe(false);
  });
});

describe("the sentence under a step", () => {
  const limits = DEFAULT_LIMITS;
  it("says when the send fires and what can stop it, from the definition itself", () => {
    const e = explainStep(quote(), 1, limits, { topicLabel: () => "Offers" });
    expect(e.fires).toContain("3 days after");
    expect(e.fires).toContain("a quote is sent");
    expect(e.fires).toContain("Standard Quote");
    expect(e.fires).toContain("Offers");
    expect(e.blockers.map((b) => b.code)).toEqual(["no_consent", "quiet_hours", "daily_cap", "account_in_trouble"]);
    expect(e.blockers.find((b) => b.code === "quiet_hours")!.text).toContain("Friday");
    expect(e.blockers.find((b) => b.code === "quiet_hours")!.text).toContain("20:00 to 08:00");
  });
  it("leaves the trouble rule out when the journey does not pause for it", () => {
    const d = quote();
    d.entry.pause_when_in_trouble = false;
    expect(explainStep(d, 1, limits).blockers.map((b) => b.code)).not.toContain("account_in_trouble");
  });
  it("explains the entry rules including 'nobody enters twice'", () => {
    const e = explainEntry(quote());
    expect(e.fires).toContain("a quote is sent");
    expect(e.blockers[0].text).toContain("Nobody enters twice");
  });
});

describe("reasons", () => {
  it("groups the reasons the page counts: consent, quiet hours, daily limit, open urgent case", () => {
    expect(reasonGroup("no_consent")).toBe("consent");
    expect(reasonGroup("withdrawn")).toBe("consent");
    expect(reasonGroup("quiet_hours")).toBe("quiet");
    expect(reasonGroup("weekly_off")).toBe("quiet");
    expect(reasonGroup("daily_cap")).toBe("cap");
    expect(reasonGroup("account_in_trouble")).toBe("trouble");
    expect(reasonLabel("account_in_trouble")).toMatch(/urgent case/);
  });
});

describe("the messages before going live", () => {
  const base = { problems: [], entrants: 12, atLeast: false, blastRadius: 200, noConsent: 0, consentChecked: 12, hasSendStep: true, busyToday: 0 };
  it("asks for confirmation above the blast radius", () => {
    const c = buildGoLiveChecks({ ...base, entrants: 250, consentChecked: 250 });
    expect(c.find((x) => x.code === "blast_radius")).toMatchObject({ level: "confirm", count: 250 });
    expect(buildGoLiveChecks(base).some((x) => x.level === "confirm")).toBe(false);
    expect(buildGoLiveChecks({ ...base, entrants: 200 }).some((x) => x.code === "blast_radius")).toBe(false);
  });
  it("counts people with no consent and people who may get two messages in a day", () => {
    const c = buildGoLiveChecks({ ...base, noConsent: 4, busyToday: 3 });
    expect(c.find((x) => x.code === "missing_consent")).toMatchObject({ level: "warn", count: 4 });
    expect(c.find((x) => x.code === "several_a_day")).toMatchObject({ level: "warn", count: 3 });
  });
  it("stops on problems and says so plainly when nothing needs a warning", () => {
    expect(buildGoLiveChecks({ ...base, problems: ["Add at least one step."] })[0]).toMatchObject({ level: "stop" });
    expect(buildGoLiveChecks(base).at(-1)).toMatchObject({ code: "clear" });
    expect(buildGoLiveChecks({ ...base, entrants: 0, consentChecked: 0 })[0].code).toBe("nobody");
  });
});

describe("run status for the page", () => {
  const now = new Date("2026-10-21T07:30:00Z");
  it("waiting, stuck and finished", () => {
    expect(classifyRun({ status: "active", next_due_at: "2026-10-24T07:00:00Z" }, now)).toBe("waiting");
    expect(classifyRun({ status: "active", next_due_at: "2026-10-21T06:00:00Z" }, now)).toBe("stuck");
    expect(classifyRun({ status: "stalled", next_due_at: null }, now)).toBe("stuck");
    expect(classifyRun({ status: "done", next_due_at: null }, now)).toBe("done");
  });
});
