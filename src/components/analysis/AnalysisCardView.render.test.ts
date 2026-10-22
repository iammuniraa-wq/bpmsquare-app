import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import AnalysisCardView, { refreshedText } from "./AnalysisCardView";
import { AnalysisConsentRow } from "@/components/assistant/WebResearch";
import { fixtureCard, type ShownCard } from "@/lib/analysis/cardFixture";
import type { DockAnalysis } from "@/lib/assistant/analysisTool";

// The analysis card as the dock draws it: four parts, every state in plain words, nothing from the web as markup, no
// sources on screen, one "i" at most, and the dock's one chip pattern for every button (44 px under 900 px).

const NOW = new Date("2026-10-22T09:00:00Z");
const data = (card: ShownCard, over: Partial<DockAnalysis> = {}): DockAnalysis => ({
  card, cached: false, saved: true, notice: null, webDerived: true, digest: "",
  subject: { accountId: card.accountId, name: card.name, domain: null, country: null }, ...over,
});
const view = (d: DockAnalysis, busy = false) =>
  renderToString(createElement(AnalysisCardView, { data: d, busy, now: NOW, onOpen: () => {}, onRefresh: () => {}, onAsk: () => {} })).replace(/<!-- -->/g, "");
const verdict = (followUp: "yes" | "not_now" | "unclear") => {
  const base = fixtureCard();
  return fixtureCard({ verdict: { ...base.verdict, followUp, label: followUp === "yes" ? "call_this_week" : followUp === "unclear" ? "not_enough" : "watch" } });
};

describe("the four parts, in order, and nothing else", () => {
  const out = view(data(fixtureCard()));
  it("verdict, what they are doing, what we have, next steps", () => {
    const at = ["Worth following up:", "What they are doing", "What we have in our system", "Next steps"].map((s) => out.indexOf(s));
    expect(at.every((n) => n > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it("shows no source, no link and no profile block", () => {
    expect(out).not.toMatch(/href=/);
    expect(out).not.toMatch(/https?:/);
    expect(out).not.toMatch(/Sources|Check these|What they do</);
  });
  it("names the company and its one identity line", () => {
    expect(out).toContain("Najd Precast Co.");
    expect(out).toContain("Riyadh, Saudi Arabia · Precast concrete · about 450 staff");
  });
  it("dates a highlight in words and classifies nothing on screen", () => {
    expect(out).toContain("Won a SAR 120 m precast concrete housing package");
    expect(out).toContain("this week");
  });
});

describe("the verdict in each of its three states", () => {
  it.each([["yes", "Yes"], ["not_now", "Not now"], ["unclear", "Unclear"]] as const)("%s reads 'Worth following up: %s' with its reason", (f, word) => {
    const out = view(data(verdict(f)));
    expect(out).toMatch(new RegExp(`Worth following up:</span><strong[^>]*>${word}</strong>`));
    expect(out).toContain("They won a big package and asked us for a quote last week.");
  });
  it("Fit and Timing sit behind an expandable line; the factors are not printed until it is opened", () => {
    const out = view(data(fixtureCard()));
    expect(out).toContain("Fit: Strong · Timing: Comparing (58)");
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("Asked for a quote");
  });
  it("timing from public news only is said so, with no stage or score", () => {
    const base = fixtureCard();
    const out = view(data(fixtureCard({ verdict: { ...base.verdict, timing: { stage: "looking", score: 12, from: "web_only" } } })));
    expect(out).toContain("Timing: from public news only");
    expect(out).not.toContain("Looking (12)");
  });
});

describe("one 'i' on the whole card, and none that hides something the person must read", () => {
  it("exactly one, on Fit and Timing", () => {
    const out = view(data(fixtureCard()));
    expect((out.match(/class="bpm-tip"/g) ?? []).length).toBe(1);
    expect(out).toContain('aria-label="About fit and timing"');
  });
  it("the analysis consent question carries none: it says what happens", () => {
    const out = renderToString(createElement(AnalysisConsentRow, { subject: "Tesla Germany", state: "pending", onChoice: () => {} }));
    expect(out).not.toContain("bpm-tip");
    expect(out).toContain("Analyse with web research?");
    expect(out).toContain("Tesla Germany");
    for (const label of ["Yes", "No"]) expect(out).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    expect((out.match(/<button/g) ?? []).length).toBe(2);
  });
  it("answered, it shrinks to one line with no buttons", () => {
    for (const [state, line] of [["yes", "Analysed with web research"], ["no", "Not analysed"], ["skipped", "Not analysed"]] as const) {
      const out = renderToString(createElement(AnalysisConsentRow, { subject: "X", state, onChoice: () => {} }));
      expect(out).toContain(line);
      expect(out).not.toContain("<button");
    }
  });
});

describe("what we have in our system", () => {
  it("an account: its facts, contacts, open work, last contact, and what is missing in plain words", () => {
    const out = view(data(fixtureCard()));
    for (const s of ["Type: Customer", "Owner: Faisal", "Khalid Al-Harbi · Site Engineer", "1 open quote, SAR 90,000", "Last: Quote QT-1 sent · 2026-10-10", "No procurement contact"]) {
      expect(out).toContain(s);
    }
  });
  it("a company that is not an account: 'Not in your system yet', similar accounts with Open, and Create account", () => {
    const out = view(data(fixtureCard({
      accountId: null,
      inSystem: { inCrm: false, account: [], contacts: [], gaps: [], openQuotes: [], openCases: [], invoicesDue: [], lastActivity: null, missing: [], similar: [{ id: "s1", name: "Najd Precast Co.", href: "/accounts/s1" }] },
    })));
    expect(out).toContain("Not in your system yet");
    expect(out).toContain("Similar accounts");
    expect(out).toContain("Najd Precast Co.");
    expect(out).toMatch(/>Open<\/button>/);
    expect(out).toContain("Create account");
    expect(out).not.toContain("Who should I talk to?");
    expect(out).not.toContain("Open account");
  });
  it("an account offers Open account and a question the chat can answer from the card", () => {
    const out = view(data(fixtureCard()));
    expect(out).toContain("Open account");
    expect(out).toContain("Who should I talk to?");
    expect(out).not.toContain("Create account");
  });
  it("a long list shows a few rows and 'Show all' (rule 6b), but what is missing is never folded away", () => {
    const base = fixtureCard();
    const contacts = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, name: `Contact ${i + 1}`, title: "Engineer", href: `/contacts/c${i}` }));
    const out = view(data(fixtureCard({ inSystem: { ...base.inSystem, contacts, missing: ["No procurement contact"] } })));
    expect(out).toContain("Show all 8");
    expect(out).not.toContain("Last: Quote");
    expect(out).toContain("No procurement contact");
  });
});

describe("empty, uncertain and limited states are said in words", () => {
  const empty = (notes: string[]) => view(data(fixtureCard({ doing: [], notes })));
  it("nothing found", () => expect(empty(["Little public information found"])).toContain("Little public information found"));
  it("no web research", () => expect(empty(["Needs web research"])).toContain("Needs web research"));
  it("nothing and no note still says so", () => expect(empty([])).toContain("Little public information found"));
  it("an old item is marked older", () => {
    const out = view(data(fixtureCard({ doing: [{ text: "Opened a plant", kind: "expansion", when: "5 months ago", stale: true }] })));
    expect(out).toContain("5 months ago, older");
  });
  it("a limit or failure is visible text, not behind an i", () => {
    const out = view(data(fixtureCard(), { notice: "The daily limit for company analyses is reached, so this is the saved one." }));
    expect(out).toMatch(/role="status"[^>]*>The daily limit/);
  });
  it("the database being pending is said, once", () => {
    const out = view(data(fixtureCard({ notes: ["Not saved: database update pending"] })));
    expect(out).toContain("Not saved: database update pending");
  });
  it("saved and fresh cards are labelled, and the age is in words", () => {
    expect(view(data(fixtureCard(), { cached: true }))).toContain("Saved 2 h ago");
    expect(view(data(fixtureCard(), { cached: false }))).toContain("Refreshed 2 h ago");
    expect(refreshedText("2026-10-22T08:59:30Z", NOW)).toBe("just now");
    expect(refreshedText("2026-10-22T08:15:00Z", NOW)).toBe("45 min ago");
    expect(refreshedText("2026-10-21T08:00:00Z", NOW)).toBe("yesterday");
    expect(refreshedText("2026-10-12T08:00:00Z", NOW)).toBe("10 days ago");
  });
});

describe("Refresh", () => {
  it("is a button on the card, and is disabled while a request is in flight", () => {
    expect(view(data(fixtureCard()))).toMatch(/<button[^>]*>Refresh<\/button>/);
    expect(view(data(fixtureCard()), true)).toMatch(/<button[^>]*disabled=""[^>]*>Refresh<\/button>/);
  });
});

describe("text from the web is text", () => {
  it("markup in a highlight, a name or an account's own fields is escaped everywhere on the card", () => {
    const evil = '<img src=x onerror=alert(1)></section><script>alert(1)</script>';
    const base = fixtureCard();
    const out = view(data(fixtureCard({
      name: evil, identity: evil,
      doing: [{ text: evil, kind: "award", when: evil, stale: false }],
      verdict: { ...base.verdict, sentence: { text: evil, byAi: true } },
      inSystem: { ...base.inSystem, account: [{ text: evil }], missing: [evil] },
      notes: [evil],
    }), { notice: evil }));
    expect(out).not.toMatch(/<img|<script|<\/section><script/i);
    expect(out).toContain("&lt;img");
  });
  it("a link never becomes an anchor: addresses are only ever handed to the dock as internal paths", () => {
    const out = view(data(fixtureCard({ doing: [{ text: "See https://evil.example/x and javascript:alert(1)", kind: "other", when: "", stale: false }] })));
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("href=");
  });
});

describe("one pattern, tap targets", () => {
  it("every button is a dock chip or row, so each is 44 px high under 900 px; the only other button is the i", () => {
    const out = view(data(fixtureCard()));
    const buttons = out.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) expect(b).toMatch(/class="(bms-dock-chip|bms-dock-row|bpm-tip)"/);
  });
});
