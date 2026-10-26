import { describe, expect, it } from "vitest";
import { DEFAULT_OPPORTUNITY_STAGES, DEFAULT_TENDER_STAGES } from "@/lib/constants";
import { isClosedStage, outcomeForStage, opportunityStages, probabilityFor } from "@/lib/sales/opportunity";
import {
  closingDateKey, closingSoon, closingState, daysUntilClosing, derivedTenderTitle, parseDecision, parseSent, parseTenderFields,
  reminderDecision, reminderMessage, stagesForDeal, tenderIsLive, tenderStages,
} from "./rules";

const TZ = "Asia/Riyadh"; // UTC+3, no daylight saving
const at = (iso: string) => new Date(iso);

describe("the tender stages", () => {
  it("are the eight the design names, in order", () => {
    expect(DEFAULT_TENDER_STAGES.map((s) => s.label)).toEqual(["Received", "Bid/No-bid", "Estimating", "Submitted", "Clarifications", "Awarded", "Lost", "No-bid"]);
  });

  it("start at Received, and only Awarded, Lost and No-bid close", () => {
    expect(DEFAULT_TENDER_STAGES.filter((s) => s.is_initial).map((s) => s.value)).toEqual(["received"]);
    expect(DEFAULT_TENDER_STAGES.filter((s) => s.is_closed).map((s) => s.label)).toEqual(["Awarded", "Lost", "No-bid"]);
  });

  it("a closed tender stage sets the same outcome a standard closed stage sets (won, lost, dropped)", () => {
    const stages = tenderStages();
    expect(outcomeForStage(stages, "awarded")).toBe("won");
    expect(outcomeForStage(stages, "bid_lost")).toBe("lost");
    expect(outcomeForStage(stages, "no_bid")).toBe("dropped");
    for (const open of ["received", "bid_no_bid", "estimating", "submitted", "clarifications"]) expect(outcomeForStage(stages, open)).toBe("open");
    expect(isClosedStage(stages, "awarded")).toBe(true);
    expect(probabilityFor(stages, "awarded", null)).toBe(100);
    expect(probabilityFor(stages, "bid_lost", null)).toBe(0);
    expect(probabilityFor(stages, "no_bid", null)).toBe(0);
  });

  it("share no stage value with the standard list, so a stored stage never reads as the other board's", () => {
    const standard = new Set(DEFAULT_OPPORTUNITY_STAGES.map((s) => s.value));
    expect(DEFAULT_TENDER_STAGES.filter((s) => standard.has(s.value))).toEqual([]);
  });
});

describe("which stage list governs a deal", () => {
  const custom = { opportunity_stages: [{ value: "a", label: "A", color: "#000", is_initial: true }, { value: "z", label: "Z", color: "#111", is_closed: true, outcome: "won" as const }] };

  it("a deal with no tender gets exactly the workspace's own list (or the defaults)", () => {
    expect(stagesForDeal(custom, false)).toEqual(opportunityStages(custom));
    expect(stagesForDeal({}, false)).toBe(DEFAULT_OPPORTUNITY_STAGES);
    expect(stagesForDeal(null, false)).toBe(DEFAULT_OPPORTUNITY_STAGES);
  });

  it("a deal with a tender gets the tender list, whatever the workspace configured", () => {
    expect(stagesForDeal(custom, true)).toBe(DEFAULT_TENDER_STAGES);
  });
});

describe("the closing-date countdown", () => {
  const now = at("2026-10-25T09:00:00Z"); // 12:00 in Riyadh, Sat 25 Oct

  it("counts whole calendar days in the workspace's timezone", () => {
    expect(daysUntilClosing("2026-10-30T09:00:00Z", now, TZ)).toBe(5);
    expect(daysUntilClosing("2026-10-25T20:59:00Z", now, TZ)).toBe(0); // 23:59 Riyadh, still today
    expect(daysUntilClosing("2026-10-25T21:01:00Z", now, TZ)).toBe(1); // just past midnight Riyadh, tomorrow
    expect(daysUntilClosing("2026-10-23T09:00:00Z", now, TZ)).toBe(-2);
    expect(daysUntilClosing(null, now, TZ)).toBeNull();
    expect(daysUntilClosing("not a date", now, TZ)).toBeNull();
  });

  it("is calm from 7 days out, amber under 7, red under 2 or past", () => {
    const tone = (iso: string) => closingState(iso, now, TZ).tone;
    expect(tone("2026-11-10T09:00:00Z")).toBe("ok");
    expect(tone("2026-11-01T09:00:00Z")).toBe("ok"); // exactly 7 days
    expect(tone("2026-10-31T09:00:00Z")).toBe("amber"); // 6
    expect(tone("2026-10-27T09:00:00Z")).toBe("amber"); // 2
    expect(tone("2026-10-26T09:00:00Z")).toBe("red"); // 1
    expect(tone("2026-10-25T18:00:00Z")).toBe("red"); // today
    expect(tone("2026-10-24T09:00:00Z")).toBe("red"); // yesterday
    expect(closingState(null, now, TZ).tone).toBe("none");
  });

  it("says it in words, not only in colour", () => {
    expect(closingState("2026-10-30T09:00:00Z", now, TZ).label).toBe("Bid ends in 5 days");
    expect(closingState("2026-10-26T09:00:00Z", now, TZ).label).toBe("Bid ends tomorrow");
    expect(closingState("2026-10-25T18:00:00Z", now, TZ).label).toBe("Bid ends today");
    expect(closingState("2026-10-24T09:00:00Z", now, TZ).label).toBe("Bid ended yesterday");
    expect(closingState("2026-10-20T09:00:00Z", now, TZ).label).toBe("Bid ended 5 days ago");
  });

  it("closingDateKey is the workspace's calendar date", () => {
    expect(closingDateKey("2026-10-25T21:30:00Z", TZ)).toBe("2026-10-26");
    expect(closingDateKey(null, TZ)).toBeNull();
  });
});

describe("closing-date reminders", () => {
  const closing = "2026-10-30T09:00:00Z";
  const run = (nowIso: string, sent: number[] = [], closingAt: string | null = closing) => reminderDecision({ closingAt, now: at(nowIso), timezone: TZ, sent });

  it("nothing earlier than 7 days out", () => {
    expect(run("2026-10-22T09:00:00Z")).toEqual({ send: false }); // 8 days
  });

  it("one reminder at 7, 3 and 1 days and on the day, each once", () => {
    expect(run("2026-10-23T09:00:00Z")).toEqual({ send: true, days: 7, mark: [7] });
    expect(run("2026-10-23T15:00:00Z", [7])).toEqual({ send: false }); // the same day, later: nothing again
    expect(run("2026-10-27T09:00:00Z", [7])).toEqual({ send: true, days: 3, mark: [3] });
    expect(run("2026-10-29T09:00:00Z", [7, 3])).toEqual({ send: true, days: 1, mark: [1] });
    expect(run("2026-10-30T05:00:00Z", [7, 3, 1])).toEqual({ send: true, days: 0, mark: [0] });
    expect(run("2026-10-30T07:00:00Z", [7, 3, 1, 0])).toEqual({ send: false });
  });

  it("running the job twice in a row never repeats: the second run is given what the first marked", () => {
    const first = run("2026-10-27T09:00:00Z", [7]);
    expect(first.send).toBe(true);
    const sent = [7, ...(first.send ? first.mark : [])];
    expect(run("2026-10-27T09:05:00Z", sent)).toEqual({ send: false });
  });

  it("a job that missed days sends ONE message and uses up every threshold passed", () => {
    expect(run("2026-10-28T09:00:00Z", [])).toEqual({ send: true, days: 2, mark: [7, 3] });
    expect(run("2026-10-28T18:00:00Z", [7, 3])).toEqual({ send: false });
  });

  it("a tender created with a day left gets one reminder, not four", () => {
    expect(run("2026-10-29T09:00:00Z", [])).toEqual({ send: true, days: 1, mark: [7, 3, 1] });
  });

  it("nothing after the closing day, and nothing without a closing date", () => {
    expect(run("2026-10-31T09:00:00Z", [])).toEqual({ send: false });
    expect(run("2026-10-27T09:00:00Z", [], null)).toEqual({ send: false });
  });

  it("parseSent keeps only the known thresholds", () => {
    expect(parseSent([3, "7", 99, 3, "x", null])).toEqual([7, 3]);
    expect(parseSent(null)).toEqual([]);
    expect(parseSent("7")).toEqual([]);
  });

  it("the message is plain text with the real number of days", () => {
    const m = reminderMessage({ title: "Pipes <b>2026</b>", tenderNo: "ARB-1", issuer: "Aramco", closingAt: closing, days: 3, timezone: TZ, link: "https://x.test/pipeline/1" });
    expect(m.subject).toBe("Bid ends in 3 days: ARB-1 · Aramco");
    expect(m.text).toContain("is in 3 days");
    expect(m.text).toContain("https://x.test/pipeline/1");
    expect(reminderMessage({ title: "T", tenderNo: null, issuer: null, closingAt: closing, days: 0, timezone: TZ, link: null }).subject).toBe("Bid ends today: T");
    expect(reminderMessage({ title: "T", tenderNo: null, issuer: null, closingAt: closing, days: 1, timezone: TZ, link: null }).subject).toBe("Bid ends tomorrow: T");
  });
});

describe("which tenders still face their deadline", () => {
  type Row = { id: string; outcome: string; stage: string; tender: { closing_at: string | null; decision: string | null } };
  const row = (over: Partial<Row> = {}): Row => ({ id: "x", outcome: "open", stage: "estimating", tender: { closing_at: "2026-10-30T09:00:00Z", decision: null }, ...over });
  const now = at("2026-10-25T09:00:00Z");

  it("only an open tender before submission, not decided no-go", () => {
    expect(tenderIsLive({ outcome: "open", stage: "received" }, { decision: null })).toBe(true);
    expect(tenderIsLive({ outcome: "open", stage: "submitted" }, { decision: null })).toBe(false);
    expect(tenderIsLive({ outcome: "open", stage: "estimating" }, { decision: "no_go" })).toBe(false);
    expect(tenderIsLive({ outcome: "dropped", stage: "no_bid" }, { decision: null })).toBe(false);
    expect(tenderIsLive({ outcome: "open", stage: "estimating" }, { decision: "go" })).toBe(true);
  });

  it("'Closing soon' lists live tenders within 14 days, overdue first, soonest next", () => {
    const rows = [
      row({ id: "far", tender: { closing_at: "2026-12-01T09:00:00Z", decision: null } }),
      row({ id: "soon", tender: { closing_at: "2026-10-29T09:00:00Z", decision: null } }),
      row({ id: "overdue", tender: { closing_at: "2026-10-23T09:00:00Z", decision: null } }),
      row({ id: "submitted", stage: "submitted" }),
      row({ id: "nodate", tender: { closing_at: null, decision: null } }),
      row({ id: "edge", tender: { closing_at: "2026-11-08T09:00:00Z", decision: null } }),
    ];
    expect(closingSoon(rows, now, TZ).map((r) => `${r.id}:${r.days}`)).toEqual(["overdue:-2", "soon:4", "edge:14"]);
  });
});

describe("the tender block a request may carry", () => {
  it("normalises every field and returns only the keys that were sent", () => {
    const r = parseTenderFields({ tender_no: "  ARB-4400123 ", issuer_name: "Saudi Aramco", portal: "ariba", closing_at: "2026-10-30T09:00:00+03:00", bid_bond_amount: "96000.456", bid_bond_currency: "sar", bid_bond_expiry: "2027-01-30", addenda_count: "2" });
    expect(r).toEqual({ ok: true, values: { tender_no: "ARB-4400123", issuer_name: "Saudi Aramco", portal: "ariba", closing_at: "2026-10-30T06:00:00.000Z", bid_bond_amount: 96000.46, bid_bond_currency: "SAR", bid_bond_expiry: "2027-01-30", addenda_count: 2 } });
    expect(parseTenderFields({ portal: "excel" })).toEqual({ ok: true, values: { portal: "excel" } });
    expect(parseTenderFields({})).toEqual({ ok: true, values: {} });
  });

  it("blank clears, nonsense is refused", () => {
    expect(parseTenderFields({ tender_no: "  ", portal: "", closing_at: "", bid_bond_amount: null })).toEqual({ ok: true, values: { tender_no: null, portal: null, closing_at: null, bid_bond_amount: null } });
    for (const bad of [{ portal: "fax" }, { closing_at: "tomorrow-ish" }, { bid_bond_amount: -1 }, { bid_bond_amount: "abc" }, { bid_bond_currency: "RIYAL" }, { bid_bond_expiry: "30/01/2027" }, { addenda_count: -1 }, { addenda_count: 1.5 }, { tender_no: 5 }]) {
      expect(parseTenderFields(bad as Record<string, unknown>).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("never carries the decision, who decided, the reminders, the source e-mail, the deal type or the tenant", () => {
    const r = parseTenderFields({ decision: "go", decided_by: "u", decided_at: "2020-01-01", reminders_sent: [7], source_email_id: "e", deal_type_id: "d", tenant_id: "t", opportunity_id: "o", tender_no: "N" });
    expect(r).toEqual({ ok: true, values: { tender_no: "N" } });
  });

  it("a no-go needs a reason; a go does not", () => {
    expect(parseDecision({ decision: "no_go" })).toEqual({ ok: false, error: "Give the reason for a no-go" });
    expect(parseDecision({ decision: "no_go", reason: "   " })).toEqual({ ok: false, error: "Give the reason for a no-go" });
    expect(parseDecision({ decision: "no_go", reason: "Out of scope" })).toEqual({ ok: true, decision: "no_go", reason: "Out of scope" });
    expect(parseDecision({ decision: "go" })).toEqual({ ok: true, decision: "go", reason: null });
    expect(parseDecision({ decision: "maybe" }).ok).toBe(false);
    expect(parseDecision({}).ok).toBe(false);
  });

  it("the title of a tender nobody titled", () => {
    expect(derivedTenderTitle({ tenderNo: "ARB-1", issuer: "Aramco", accountName: "Acme" })).toBe("ARB-1 · Aramco");
    expect(derivedTenderTitle({ tenderNo: "ARB-1", issuer: null, accountName: "Acme" })).toBe("ARB-1 · Acme");
    expect(derivedTenderTitle({ tenderNo: null, issuer: null, accountName: null })).toBe("Tender");
  });
});
