import type { AnalysisCard } from "./types";

// A finished analysis card for the screens' tests. Not a test file: it has no assertions, so the dock's render tests and the
// tool's unit tests build the same card and change one field each.

export type ShownCard = Omit<AnalysisCard, "internal">;

export function fixtureCard(over: Partial<ShownCard> = {}): ShownCard {
  return {
    id: "an_1", companyKey: "najdprecast.com", accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "Najd Precast Co.",
    identity: "Riyadh, Saudi Arabia · Precast concrete · about 450 staff",
    verdict: {
      followUp: "yes", label: "call_this_week", fit: "strong", timing: { stage: "comparing", score: 58, from: "signals" }, rule: 1,
      because: "A good fit that is comparing or deciding",
      sentence: { text: "They won a big package and asked us for a quote last week.", byAi: true },
      factors: [
        { group: "asked", label: "Industry matches a segment", points: 3, detail: "Precast concrete matches your segment Precast", area: "fit" },
        { group: "asked", label: "Asked for a quote", points: 14, detail: "Quote QT-0042 on 12 Oct", area: "timing" },
        { group: "moving", label: "Award", points: 8, detail: "Won a SAR 120 m package", area: "timing" },
        { group: "visited", label: "Quiet on the site", points: 0, detail: "No visits", area: "timing" },
      ],
    },
    doing: [{ text: "Won a SAR 120 m precast concrete housing package", kind: "award", when: "this week", stale: false, topic: "Precast" }],
    inSystem: {
      inCrm: true,
      account: [{ text: "Type: Customer" }, { text: "Owner: Faisal" }, { text: "In your system since Mar 2024" }],
      contacts: [{ id: "c1", name: "Khalid Al-Harbi", title: "Site Engineer", role: "technical", href: "/contacts/c1" }],
      gaps: [{ role: "procurement", text: "No procurement contact yet" }],
      openQuotes: [{ text: "1 open quote, SAR 90,000", href: "/quotations" }],
      openCases: [], invoicesDue: [],
      lastActivity: { text: "Quote QT-1 sent", date: "2026-10-10T00:00:00.000Z" },
      missing: ["No procurement contact"], similar: [],
    },
    nextSteps: [], refreshedAt: "2026-10-22T07:00:00.000Z", expiresAt: "2026-10-29T07:00:00.000Z", stale: false, notes: [],
    ...over,
  };
}
