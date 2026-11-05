import { describe, expect, it } from "vitest";
import type { Invoice, Quote, ServiceCase } from "@/lib/types";
import { CURRENCIES } from "@/lib/currency";
import {
  agoWords, buildRichSummary, gateByModules, initialsOf, latestTouches, meshFor, nextBestStep, ringToneFor, weakestFactor,
  type RichModules, type RichRecordData,
} from "./accountRecord";

const NOW = new Date("2026-11-05T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const ALL: RichModules = { quotations: true, cases: true, invoices: true, contacts: true, amc: true };
const cur = CURRENCIES.INR;

const quote = (o: Partial<Quote>): Quote => ({ id: "q1", ref: "QT-1", total: 1000, outcome: "open", created_at: daysAgo(2), closed_at: null, ...o } as Quote);
const kase = (o: Partial<ServiceCase>): ServiceCase => ({ id: "c1", ref: "C-1", status: "intake", intake_at: daysAgo(2), closed_at: null, ...o } as ServiceCase);
const invoice = (o: Partial<Invoice>): Invoice => ({ id: "i1", ref: "INV-1", status: "sent", total: 500, paid_amount: 0, due_date: null, issued_at: daysAgo(3), created_at: daysAgo(3), ...o } as Invoice);
const data = (o: Partial<RichRecordData> = {}): RichRecordData => ({ quotes: [], cases: [], invoices: [], contacts: [{}, {}, {}], contracts: [], ...o });

describe("words and identity", () => {
  it("says time plainly", () => {
    expect(agoWords(0)).toBe("Today");
    expect(agoWords(1)).toBe("Yesterday");
    expect(agoWords(5)).toBe("5 days ago");
    expect(agoWords(8)).toBe("1 week ago");
    expect(agoWords(21)).toBe("3 weeks ago");
    expect(agoWords(45)).toBe("1 month ago");
    expect(agoWords(400)).toBe("1 year ago");
  });
  it("takes initials from the first two words and survives odd names", () => {
    expect(initialsOf("Vikas Pioneers Pvt")).toBe("VP");
    expect(initialsOf("acme")).toBe("A");
    expect(initialsOf("   ")).toBe("?");
  });
  it("gives the same account the same gradient every time", () => {
    expect(meshFor("Acme")).toBe(meshFor("Acme"));
    expect(["a", "b", "c", "d", "e", "f"]).toContain(meshFor("Anything"));
  });
});

describe("gateByModules", () => {
  it("empties what the tenant does not own, so nothing can be shown from it", () => {
    const g = gateByModules(data({ quotes: [quote({})], cases: [kase({})], invoices: [invoice({})] }), { ...ALL, quotations: false, cases: false });
    expect(g.quotes).toEqual([]);
    expect(g.cases).toEqual([]);
    expect(g.invoices).toHaveLength(1);
  });
});

describe("latestTouches", () => {
  const ev = (id: string, d: string) => ({ id, date: d, title: id, detail: "", tone: "neutral" as const, href: "/x" });
  it("returns newest first, at most five, never from the future", () => {
    const events = [ev("account:created", daysAgo(300)), ev("quote:1:created", daysAgo(5)), ev("case:1:opened", daysAgo(2)), ev("contract:1:started", daysAgo(-10)),
      ev("invoice:1:issued", daysAgo(9)), ev("quote:2:created", daysAgo(20)), ev("quote:3:created", daysAgo(40))];
    const t = latestTouches(events, 5, NOW);
    expect(t.map((x) => x.id)).toEqual(["case:1:opened", "quote:1:created", "invoice:1:issued", "quote:2:created", "quote:3:created"]);
    expect(t[0]).toMatchObject({ kind: "case", when: "2 days ago", days: 2 });
  });
});

describe("buildRichSummary", () => {
  it("leaves a card out when its data does not exist", () => {
    const s = buildRichSummary(data(), [], NOW);
    expect(s.pipeline).toBeNull();
    expect(s.openCases).toBeNull();
    expect(s.outstanding).toBeNull();
    expect(s.lastTouch).toBeNull();
    expect(s.health.score).toBeGreaterThanOrEqual(0);
  });
  it("counts only open quotes and open cases, and what is really owed", () => {
    const s = buildRichSummary(data({
      quotes: [quote({ total: 1000 }), quote({ id: "q2", total: 500, outcome: "won" })],
      cases: [kase({}), kase({ id: "c2", status: "closed" }), kase({ id: "c3", intake_at: daysAgo(40) })],
      invoices: [invoice({ total: 500, paid_amount: 200 }), invoice({ id: "i2", status: "draft", total: 900 })],
    }), [], NOW);
    expect(s.pipeline).toEqual({ value: 1000, openCount: 1 });
    expect(s.openCases).toEqual({ open: 2, aged: 1 });
    expect(s.outstanding).toEqual({ amount: 300, overdueCount: 0 });
  });
  it("takes the last touch from real events, not the account being created", () => {
    const touches = latestTouches([
      { id: "account:created", date: daysAgo(1), title: "Account created", detail: "", tone: "neutral", href: "/a" },
      { id: "quote:1:created", date: daysAgo(6), title: "Quote QT-1 sent", detail: "", tone: "neutral", href: "/q" },
    ], 5, NOW);
    expect(buildRichSummary(data(), touches, NOW).lastTouch?.id).toBe("quote:1:created");
  });
  it("colours the ring by grade, never by a made-up number", () => {
    expect(ringToneFor("A")).toBe("good");
    expect(ringToneFor("C")).toBe("violet");
    expect(ringToneFor("D")).toBe("warm");
  });
});

describe("nextBestStep", () => {
  it("is null when nothing needs doing", () => {
    expect(nextBestStep("a1", data(), cur, ALL, NOW)).toBeNull();
  });
  it("puts overdue money first and says how many others wait", () => {
    const step = nextBestStep("a1", data({
      invoices: [invoice({ due_date: daysAgo(10), total: 1000, paid_amount: 100 })],
      cases: [kase({ intake_at: daysAgo(50) })],
    }), cur, ALL, NOW);
    expect(step?.id).toBe("chase-overdue");
    expect(step?.title).toContain("900");
    expect(step?.href).toBe("/invoices/i1");
    expect(step?.more).toBe(1);
  });
  it("follows up a quotation open for over three weeks", () => {
    const step = nextBestStep("a1", data({ quotes: [quote({ created_at: daysAgo(30), total: 4000 })] }), cur, ALL, NOW);
    expect(step?.id).toBe("stale-quotes");
    expect(step?.urgency).toBe("high");
  });
  it("asks for a contact only when the contacts module is on", () => {
    const empty = data({ contacts: [] });
    expect(nextBestStep("a1", empty, cur, ALL, NOW)?.id).toBe("single-threaded");
    expect(nextBestStep("a1", empty, cur, { ...ALL, contacts: false }, NOW)).toBeNull();
  });
  it("is the same sentence every time it is asked", () => {
    const d = data({ quotes: [quote({ created_at: daysAgo(30) })] });
    expect(nextBestStep("a1", d, cur, ALL, NOW)).toEqual(nextBestStep("a1", d, cur, ALL, NOW));
  });
});

describe("weakestFactor", () => {
  it("names the signal that costs the most points", () => {
    const f = weakestFactor({ score: 40, grade: "C", label: "Needs attention", factors: [
      { label: "Recency", points: 25, detail: "Active 2 days ago" },
      { label: "Payment", points: 4, detail: "3 overdue invoices" },
      { label: "Service", points: 10, detail: "1 case open" },
    ] });
    expect(f).toEqual({ label: "Payment", detail: "3 overdue invoices" });
  });
  it("is null when every signal is full", () => {
    expect(weakestFactor({ score: 100, grade: "A", label: "Healthy", factors: [{ label: "Recency", points: 25, detail: "x" }] })).toBeNull();
  });
});
