import { describe, expect, it } from "vitest";
import { CALL_LIMITS, isDayKey, isOverdue, newestFirst, nextStepProblem, overdueSummary, parseCallEdit, parseNewCall } from "./calls";
import { comparisonText, isOutcomeStage, parseOutcome, priceComparison } from "./outcome";

// Logged calls and the outcome facts (slice 4): the field limits, the overdue rule, what an outcome requires.

const NOW = new Date("2026-10-26T10:00:00Z");

describe("logging a call", () => {
  it("needs only what was discussed; kind defaults to call and the time to now", () => {
    const r = parseNewCall({ summary: " Spoke to the consultant " }, NOW);
    expect(r).toEqual({ ok: true, value: { kind: "call", occurred_at: NOW.toISOString(), with_whom: null, summary: "Spoke to the consultant", outcome: null, next_step: null, next_step_due: null } });
    expect(parseNewCall({}, NOW)).toMatchObject({ ok: false });
    expect(parseNewCall({ summary: "  " }, NOW)).toMatchObject({ ok: false });
  });

  it("holds every field to its limit", () => {
    const ok = { summary: "x" };
    expect(parseNewCall({ summary: "x".repeat(CALL_LIMITS.summaryMax) }, NOW)).toMatchObject({ ok: true });
    expect(parseNewCall({ summary: "x".repeat(CALL_LIMITS.summaryMax + 1) }, NOW)).toMatchObject({ ok: false });
    expect(parseNewCall({ ...ok, with_whom: "w".repeat(CALL_LIMITS.withMax + 1) }, NOW)).toMatchObject({ ok: false });
    expect(parseNewCall({ ...ok, outcome: "o".repeat(CALL_LIMITS.outcomeMax + 1) }, NOW)).toMatchObject({ ok: false });
    expect(parseNewCall({ ...ok, next_step: "n".repeat(CALL_LIMITS.nextStepMax + 1) }, NOW)).toMatchObject({ ok: false });
  });

  it("accepts only the four kinds, real dates, and no contact dated in the future", () => {
    expect(parseNewCall({ summary: "x", kind: "visit" }, NOW)).toMatchObject({ ok: false });
    expect(parseNewCall({ summary: "x", kind: "site_visit" }, NOW)).toMatchObject({ ok: true });
    expect(parseNewCall({ summary: "x", next_step: "Send addendum", next_step_due: "2026-02-30" }, NOW)).toMatchObject({ ok: false });
    expect(parseNewCall({ summary: "x", next_step: "Send", next_step_due: "2026-11-03" }, NOW)).toMatchObject({ ok: true });
    expect(parseNewCall({ summary: "x", occurred_at: "not a date" }, NOW)).toMatchObject({ ok: false });
    expect(parseNewCall({ summary: "x", occurred_at: "2026-10-27T11:00:00Z" }, NOW)).toMatchObject({ ok: false });
    expect(parseNewCall({ summary: "x", occurred_at: "2026-10-26T20:00:00Z" }, NOW)).toMatchObject({ ok: true });
    expect(parseNewCall({ summary: "x", occurred_at: "1990-01-01" }, NOW)).toMatchObject({ ok: false });
  });

  it("ignores fields that are not on the allow-list (the logger, the workspace, the done stamp)", () => {
    const r = parseNewCall({ summary: "x", logged_by: "someone", tenant_id: "t2", next_step_done_at: "2026-10-01", id: "mine" }, NOW);
    expect(r.ok && Object.keys(r.value).sort()).toEqual(["kind", "next_step", "next_step_due", "occurred_at", "outcome", "summary", "with_whom"]);
  });

  it("a due date needs a next step", () => {
    expect(nextStepProblem({ next_step: null, next_step_due: "2026-11-01" })).toMatch(/next step/);
    expect(nextStepProblem({ next_step: "Call back", next_step_due: "2026-11-01" })).toBeNull();
    expect(nextStepProblem({ next_step: "Call back", next_step_due: null })).toBeNull();
  });

  it("an edit returns only the keys it carries and refuses an empty one", () => {
    expect(parseCallEdit({ next_step_done: true }, NOW)).toEqual({ ok: true, value: { next_step_done: true } });
    expect(parseCallEdit({ summary: "Better wording" }, NOW)).toEqual({ ok: true, value: { summary: "Better wording" } });
    expect(parseCallEdit({ summary: "" }, NOW)).toMatchObject({ ok: false });
    expect(parseCallEdit({}, NOW)).toMatchObject({ ok: false });
    expect(parseCallEdit({ logged_by: "x" }, NOW)).toMatchObject({ ok: false });
    expect(parseCallEdit({ next_step: "", next_step_due: null }, NOW)).toEqual({ ok: true, value: { next_step: null, next_step_due: null } });
  });

  it("day keys are real calendar days", () => {
    expect(isDayKey("2026-02-28")).toBe(true);
    expect(isDayKey("2026-02-30")).toBe(false);
    expect(isDayKey("26-02-28")).toBe(false);
    expect(isDayKey(20260228)).toBe(false);
  });
});

describe("overdue next steps", () => {
  const step = (due: string | null, done: string | null = null, next: string | null = "Chase") => ({ next_step: next, next_step_due: due, next_step_done_at: done });
  it("is overdue only when it has a step and a past due date and was not ticked off", () => {
    expect(isOverdue(step("2026-10-25"), "2026-10-26")).toBe(true);
    expect(isOverdue(step("2026-10-26"), "2026-10-26")).toBe(false);
    expect(isOverdue(step("2026-10-25", "2026-10-25T09:00:00Z"), "2026-10-26")).toBe(false);
    expect(isOverdue(step(null), "2026-10-26")).toBe(false);
    expect(isOverdue(step("2026-10-25", null, null), "2026-10-26")).toBe(false);
  });

  it("counts them and names the oldest", () => {
    const s = overdueSummary([step("2026-10-20", null, "Old one"), step("2026-10-24", null, "Newer"), step("2026-11-01"), step("2026-10-01", "2026-10-02T00:00:00Z")], "2026-10-26");
    expect(s).toEqual({ count: 2, oldest_due: "2026-10-20", first: "Old one" });
    expect(overdueSummary([], "2026-10-26")).toEqual({ count: 0, oldest_due: null, first: null });
  });

  it("lists newest first", () => {
    expect(newestFirst([{ occurred_at: "2026-10-01T00:00:00Z", n: 1 }, { occurred_at: "2026-10-09T00:00:00Z", n: 2 }]).map((x) => x.n)).toEqual([2, 1]);
  });
});

describe("the outcome facts", () => {
  const none = { competitor: null, loss_reason: null, winning_bidder: null };

  it("knows the three outcome stages", () => {
    expect(["awarded", "bid_lost", "no_bid"].every(isOutcomeStage)).toBe(true);
    expect(["estimating", "submitted", "won"].some(isOutcomeStage)).toBe(false);
  });

  it("Lost requires the reason and who won, typed now or already on the deal", () => {
    expect(parseOutcome("bid_lost", {}, none)).toMatchObject({ ok: false });
    expect(parseOutcome("bid_lost", { loss_reason: "price" }, none)).toMatchObject({ ok: false, error: expect.stringMatching(/who won/i) });
    expect(parseOutcome("bid_lost", { winning_bidder: "Rival Co" }, none)).toMatchObject({ ok: false, error: expect.stringMatching(/why/i) });
    expect(parseOutcome("bid_lost", { winning_bidder: "Rival Co", loss_reason: "price", award_value: "1,250,000.5" }, none)).toEqual({
      ok: true, tender: { winning_bidder: "Rival Co", award_value: 1250000.5 }, deal: { competitor: "Rival Co", loss_reason: "price" },
    });
    // Already on the deal: an edit of the note alone is fine.
    expect(parseOutcome("bid_lost", { outcome_note: "Debrief held" }, { competitor: "Rival Co", loss_reason: "price", winning_bidder: null })).toMatchObject({ ok: true });
    // But the winner cannot be blanked.
    expect(parseOutcome("bid_lost", { winning_bidder: "  " }, { competitor: "Rival Co", loss_reason: "price", winning_bidder: "Rival Co" })).toMatchObject({ ok: false });
    expect(parseOutcome("bid_lost", { winning_bidder: "R", loss_reason: "weather" }, none)).toMatchObject({ ok: false });
  });

  it("Awarded takes the value, the date and a note, and never touches the deal's loss columns", () => {
    expect(parseOutcome("awarded", { award_value: 900000, award_date: "2026-11-10", outcome_note: "LOA received", loss_reason: "price", winning_bidder: "x" }, none)).toEqual({
      ok: true, tender: { award_value: 900000, award_date: "2026-11-10", outcome_note: "LOA received" }, deal: {},
    });
    expect(parseOutcome("awarded", {}, none)).toEqual({ ok: true, tender: {}, deal: {} });
  });

  it("No-bid takes only the note", () => {
    expect(parseOutcome("no_bid", { outcome_note: "Out of scope", award_value: 5, winning_bidder: "x" }, none)).toEqual({ ok: true, tender: { outcome_note: "Out of scope" }, deal: {} });
  });

  it("checks the value, the date and the lengths", () => {
    expect(parseOutcome("awarded", { award_value: -1 }, none)).toMatchObject({ ok: false });
    expect(parseOutcome("awarded", { award_value: "abc" }, none)).toMatchObject({ ok: false });
    expect(parseOutcome("awarded", { award_value: 1e14 }, none)).toMatchObject({ ok: false });
    expect(parseOutcome("awarded", { award_value: "" }, none)).toEqual({ ok: true, tender: { award_value: null }, deal: {} });
    expect(parseOutcome("awarded", { award_date: "2026-13-01" }, none)).toMatchObject({ ok: false });
    expect(parseOutcome("awarded", { outcome_note: "n".repeat(1001) }, none)).toMatchObject({ ok: false });
    expect(parseOutcome("bid_lost", { winning_bidder: "w".repeat(201), loss_reason: "price" }, none)).toMatchObject({ ok: false });
  });
});

describe("our bid beside the winning price", () => {
  it("shows the difference in amount and as a percent of the winning price", () => {
    expect(priceComparison(1_030_000, 1_000_000)).toEqual({ ours: 1_030_000, theirs: 1_000_000, diff: 30_000, pct: 3 });
    expect(priceComparison(950_000, 1_000_000)).toEqual({ ours: 950_000, theirs: 1_000_000, diff: -50_000, pct: -5 });
  });

  it("is null when either side is unknown, and has no percent against a zero price", () => {
    expect(priceComparison(null, 100)).toBeNull();
    expect(priceComparison(100, null)).toBeNull();
    expect(priceComparison(100, 0)?.pct).toBeNull();
  });

  it("says it in one sentence", () => {
    expect(comparisonText(priceComparison(1_032_000, 1_000_000)!, "winning price")).toBe("Our bid was 3.20% above the winning price");
    expect(comparisonText(priceComparison(900, 1000)!, "awarded price")).toBe("Our bid was 10.00% below the awarded price");
    expect(comparisonText(priceComparison(1000, 1000)!, "awarded price")).toBe("Our bid matched the awarded price");
  });
});
