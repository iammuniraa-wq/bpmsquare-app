import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import {
  accountSuggestions, contactSuggestions, estimateSuggestions, filterByAccess, leadSuggestions, opportunitySuggestions,
  ownWorkSuggestions, productSuggestions, quoteSuggestions, standardQuoteSuggestions, suggestionsFor, MAX_SUGGESTIONS,
  type Suggestion,
} from "./suggestions";

const NOW = new Date("2026-10-21T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const inDays = (n: number) => daysAgo(-n);
const ids = (l: Suggestion[]) => l.map((s) => s.id);

const ALL = { features: new Proxy({}, { get: () => true }) as Record<string, boolean>, canView: () => true };

describe("account", () => {
  const row = { id: "a1", name: "Al-Otaibi Contracting" };
  it("asks for a contact when none is saved, and links the new contact to the account", () => {
    const l = accountSuggestions(row, { contacts: [], quotes: [{ id: "q1", ref: "SQ-1", status: "sent", created_at: daysAgo(1) }] }, NOW);
    expect(l[0]).toMatchObject({ id: "account.add-contact", kind: "navigate", target: "/contacts/new?account_id=a1" });
  });
  it("points at a draft older than a week, by its own reference", () => {
    const l = accountSuggestions(row, { contacts: [{}], quotes: [{ id: "q9", ref: "SQ-9", status: "draft", created_at: daysAgo(9) }] }, NOW);
    expect(l.find((s) => s.id === "account.finish-draft")).toMatchObject({ target: "/quotations/q9" });
    expect(l.find((s) => s.id === "account.finish-draft")?.why).toContain("9 days");
  });
  it("a fresh draft is not nagged about", () => {
    const l = accountSuggestions(row, { contacts: [{}], quotes: [{ id: "q9", ref: "SQ-9", status: "draft", created_at: daysAgo(2) }] }, NOW);
    expect(ids(l)).not.toContain("account.finish-draft");
  });
  it("asks about unpaid invoices and open cases only when the data says so", () => {
    const l = accountSuggestions(row, { contacts: [{}], quotes: [{ id: "q", ref: "Q", status: "sent", created_at: daysAgo(1), balance_due: 500 }], cases: [{ closed_at: null }, { closed_at: "x" }] }, NOW);
    expect(ids(l)).toEqual(expect.arrayContaining(["account.unpaid", "account.open-cases"]));
    expect(l.find((s) => s.id === "account.open-cases")?.question).toContain("Al-Otaibi");
    expect(accountSuggestions(row, { contacts: [{}], quotes: [{ id: "q", ref: "Q", status: "sent", created_at: daysAgo(1), balance_due: 0 }], cases: [] }, NOW)).toEqual([]);
  });
  it("offers a first quotation for an account with none", () => {
    expect(ids(accountSuggestions(row, { contacts: [{}], quotes: [] }, NOW))).toContain("account.first-quote");
  });
  it("stays silent about what it could not load", () => {
    expect(accountSuggestions(row, {}, NOW)).toEqual([]);
  });
});

describe("contact", () => {
  it("goes to the account first, then asks about its quotes and colleagues", () => {
    const l = contactSuggestions({ id: "c1", name: "Faisal", account: { id: "a1", name: "Al-Otaibi" } });
    expect(ids(l)).toEqual(["contact.open-account", "contact.quotes", "contact.colleagues"]);
    expect(l[0].target).toBe("/accounts/a1");
  });
  it("nothing without an account", () => {
    expect(contactSuggestions({ id: "c1", name: "Faisal" })).toEqual([]);
  });
});

describe("quote", () => {
  const base = { id: "q1", ref: "SQ-2026-0012", status: "draft", outcome: "open", created_at: daysAgo(8), account: { id: "a1", name: "Al-Otaibi" }, invoice_count: 0, balance_due: 0 };
  it("finish a draft that is more than a week old", () => {
    expect(quoteSuggestions(base, {}, NOW)[0]).toMatchObject({ id: "quote.finish", target: "/quotations/q1/edit" });
    expect(ids(quoteSuggestions({ ...base, created_at: daysAgo(3) }, {}, NOW))).not.toContain("quote.finish");
  });
  it("warns before and after the validity date, only while the quote is open", () => {
    expect(ids(quoteSuggestions({ ...base, status: "sent", created_at: daysAgo(1), valid_until: inDays(3) }, {}, NOW))).toContain("quote.expiring");
    expect(ids(quoteSuggestions({ ...base, status: "sent", created_at: daysAgo(1), valid_until: daysAgo(2) }, {}, NOW))).toContain("quote.expired");
    expect(quoteSuggestions({ ...base, status: "sent", outcome: "won", created_at: daysAgo(1), valid_until: daysAgo(2), invoice_count: 1 }, {}, NOW)).toEqual([]);
  });
  it("a sent quote with no answer after ten days points at the account", () => {
    const l = quoteSuggestions({ ...base, status: "sent", created_at: daysAgo(12) }, {}, NOW);
    expect(l.find((s) => s.id === "quote.chase")).toMatchObject({ target: "/accounts/a1" });
  });
  it("a won quote with no invoice offers one, for the same account", () => {
    const l = quoteSuggestions({ ...base, status: "approved", outcome: "won", created_at: daysAgo(2) }, {}, NOW);
    expect(l.find((s) => s.id === "quote.invoice")).toMatchObject({ target: "/invoices/new?account_id=a1" });
  });
  it("an invoiced quote with a balance asks which invoices are open", () => {
    expect(ids(quoteSuggestions({ ...base, status: "approved", outcome: "won", created_at: daysAgo(2), invoice_count: 2, balance_due: 900 }, {}, NOW))).toContain("quote.unpaid");
  });
});

describe("standard quote", () => {
  it("finish an old draft; chase an old sent one; flag an expired one", () => {
    const base = { id: "s1", ref: "STQ-1", account: { id: "a", name: "Gulf Steel" } };
    expect(ids(standardQuoteSuggestions({ ...base, status: "draft", created_at: daysAgo(10) }, NOW))).toContain("sq.finish");
    expect(ids(standardQuoteSuggestions({ ...base, status: "sent", sent_at: daysAgo(12), created_at: daysAgo(14) }, NOW))).toContain("sq.chase");
    expect(ids(standardQuoteSuggestions({ ...base, status: "sent", sent_at: daysAgo(3), created_at: daysAgo(4), valid_until: daysAgo(1) }, NOW))).toContain("sq.expired");
  });
});

describe("product", () => {
  it("asks for a price and a category when they are missing", () => {
    const l = productSuggestions({ id: "p1", name: "Gate", list_price: 0, category: "" });
    expect(ids(l)).toEqual(["product.price", "product.category"]);
    expect(l[0].target).toBe("/products/p1");
  });
  it("a complete product compares itself with its category", () => {
    expect(ids(productSuggestions({ id: "p1", name: "Gate", list_price: 10, category: "Fencing" }))).toEqual(["product.same-category"]);
  });
});

describe("lead", () => {
  it("a lead that has sat new for two days is worked from the list; an inspected one starts a quote", () => {
    const acc = { id: "a1", name: "Riyadh Homes" };
    expect(ids(leadSuggestions({ title: "Villas", status: "new", created_at: daysAgo(3), account: acc }, NOW))).toContain("lead.pick-up");
    expect(ids(leadSuggestions({ title: "Villas", status: "new", created_at: daysAgo(1), account: acc }, NOW))).not.toContain("lead.pick-up");
    expect(leadSuggestions({ title: "Villas", status: "inspecting", created_at: daysAgo(1), account: acc }, NOW)[0]).toMatchObject({ id: "lead.quote", target: "/quotations/new?account_id=a1" });
  });
});

describe("opportunity", () => {
  it("overdue close date, missing amount, quiet deal", () => {
    const row = { id: "o1", ref: "OPP-1", title: "Tower", outcome: "open", expected_close: daysAgo(4), amount: 0, updated_at: daysAgo(20), account_id: "a1", account_name: "Skyline" };
    expect(ids(opportunitySuggestions(row, NOW))).toEqual(["opp.close-date", "opp.amount", "opp.stale", "opp.quote"]);
    expect(opportunitySuggestions({ ...row, outcome: "won" }, NOW)).toEqual([]);
  });
});

describe("estimate", () => {
  it("continue an old draft, review a missing price", () => {
    const l = estimateSuggestions({ id: "e1", status: "draft", created_at: daysAgo(8), quoted_total: null, account: { name: "PCBS" } }, NOW);
    expect(ids(l)).toEqual(["est.continue", "est.price", "est.account"]);
  });
});

describe("the strip", () => {
  it("never shows more than three, and a hidden suggestion leaves no gap", () => {
    const opp = { id: "o1", ref: "OPP-1", title: "Tower", outcome: "open", expected_close: daysAgo(4), amount: 0, updated_at: daysAgo(20), account_id: "a1", account_name: "Skyline" };
    const all = suggestionsFor("opportunity", opp, {}, NOW);
    expect(all.length).toBeGreaterThan(MAX_SUGGESTIONS);
    expect(filterByAccess(all, ALL)).toHaveLength(3);
    // Without the quotations module the last one drops out; the others still fill the strip.
    const noQuotes = filterByAccess(all, { features: { pipeline: true, quotations: false }, canView: () => true });
    expect(ids(noQuotes)).toEqual(["opp.close-date", "opp.amount"]);
  });
  it("a workcenter the person cannot view removes the suggestion that needs it", () => {
    const l = suggestionsFor("contact", { id: "c", name: "F", account: { id: "a", name: "Acme" } }, {}, NOW);
    const l2 = filterByAccess(l, { features: new Proxy({}, { get: () => true }) as Record<string, boolean>, canView: (wc) => wc !== "accounts" });
    expect(ids(l2)).not.toContain("contact.open-account");
    expect(ids(l2)).toContain("contact.quotes");
  });
  it("object types without rules give nothing", () => {
    expect(suggestionsFor("supplier", { id: "s" }, {}, NOW)).toEqual([]);
  });
  it("every suggestion is plain: label short, why within the InfoTip limit, a question or a path", () => {
    const rows: Suggestion[] = [
      ...accountSuggestions({ id: "a", name: "A" }, { contacts: [], quotes: [{ id: "q", ref: "Q-1", status: "draft", created_at: daysAgo(9), balance_due: 1 }], cases: [{ closed_at: null }] }, NOW),
      ...quoteSuggestions({ id: "q", ref: "Q-1", status: "sent", outcome: "open", created_at: daysAgo(30), valid_until: daysAgo(3), account: { id: "a", name: "A" } }, {}, NOW),
      ...standardQuoteSuggestions({ id: "s", ref: "S-1", status: "sent", sent_at: daysAgo(30), created_at: daysAgo(31), valid_until: daysAgo(3), account: { name: "A" } }, NOW),
      ...opportunitySuggestions({ id: "o", ref: "O", title: "T", outcome: "open", expected_close: daysAgo(4), amount: 0, updated_at: daysAgo(20), account_id: "a", account_name: "A" }, NOW),
      ...productSuggestions({ id: "p", name: "N", list_price: 0, category: "" }),
      ...leadSuggestions({ title: "L", status: "new", created_at: daysAgo(5), account: { id: "a", name: "A" } }, NOW),
      ...estimateSuggestions({ id: "e", status: "draft", created_at: daysAgo(8), account: { name: "A" } }, NOW),
      ...ownWorkSuggestions({ staleDrafts: [{ id: "1", ref: "Q-1" }, { id: "2", ref: "Q-2" }], readyLeads: 2, overdueSteps: 1 }),
    ];
    expect(rows.length).toBeGreaterThan(15);
    for (const s of rows) {
      expect(tipTextProblems(s.why), `${s.id}: ${s.why}`).toEqual([]);
      expect(s.label.length, s.id).toBeLessThanOrEqual(40);
      if (s.kind === "navigate") expect(s.target, s.id).toMatch(/^\/[A-Za-z0-9/_\-.?=&]*$/);
      else expect(s.question, s.id).toBeTruthy();
    }
  });
});

describe("with no record open: the person's own work", () => {
  it("one stale draft opens it; several open the list and name them", () => {
    expect(ownWorkSuggestions({ staleDrafts: [{ id: "q1", ref: "SQ-1" }] })[0]).toMatchObject({ id: "own.draft", target: "/quotations/q1/edit" });
    const many = ownWorkSuggestions({ staleDrafts: [{ id: "1", ref: "A" }, { id: "2", ref: "B" }, { id: "3", ref: "C" }, { id: "4", ref: "D" }] });
    expect(many[0]).toMatchObject({ id: "own.drafts", target: "/quotations" });
    expect(many[0].why).toContain("and more");
  });
  it("ready leads and overdue steps are counted, nothing is made up when there are none", () => {
    expect(ids(ownWorkSuggestions({ readyLeads: 3, overdueSteps: 2 }))).toEqual(["own.leads", "own.steps"]);
    expect(ownWorkSuggestions({ staleDrafts: [], readyLeads: 0, overdueSteps: 0 })).toEqual([]);
    expect(ownWorkSuggestions({})).toEqual([]);
  });
});
