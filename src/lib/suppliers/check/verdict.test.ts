import { describe, expect, it } from "vitest";
import { computeRating } from "./rating";
import { computeSignals } from "./signals";
import { combineVerdict } from "./verdict";
import { emptyReputation, sentimentOf } from "./reputation";
import { NOW, SID, history, identity, othersOf } from "./fixtures";
import type { Reputation, ReputationFact } from "./types";

const verdictOf = (id: string, reputation: Reputation = emptyReputation(), tweak?: (i: ReturnType<typeof identity>) => ReturnType<typeof identity>) => {
  const subject = tweak ? tweak(identity(id)) : identity(id);
  const findings = computeSignals(subject, othersOf(id), { now: NOW });
  const rating = computeRating({ supplierId: id, now: NOW, ...history() });
  return combineVerdict({ findings, rating, reputation, hasWebsite: !!subject.website, hasCr: !!subject.cr, hasTaxId: !!subject.taxId });
};

const web = (facts: ReputationFact[], over: Partial<Reputation> = {}): Reputation => ({
  webUsed: true, partial: false, sentiment: sentimentOf(facts), facts, sources: [{ title: "Page", url: "https://example.com/a" }], summary: "", searches: 5, ...over,
});
const fact = (kind: ReputationFact["kind"], text = "text", when?: string): ReputationFact => ({ kind, text, src: 1, ...(when ? { when } : {}) });

describe("the combined verdict", () => {
  it("the same bank details under another company name is CONCERNING, with the reason first and the caveat", () => {
    const v = verdictOf(SID.najd);
    expect(v.verdict).toBe("concerning");
    expect(v.sentence).toMatch(/^Concerning: the bank details are the same as Arkan Waterproofing Systems/);
    expect(v.sentence).toMatch(/risk indicator, not a legal finding/);
    expect(v.sentence).not.toMatch(/fraud|scam|criminal/i);
  });

  it("a thin demo-style supplier (no website, thin history, no web) is UNVERIFIED, honestly, and says what would sharpen the result", () => {
    const v = verdictOf(SID.tihama);
    expect(v.verdict).toBe("unverified");
    expect(v.sentence).toMatch(/Could not verify/);
    expect(v.sentence).toMatch(/not a finding against it/);
    expect(v.sharpen.join(" ")).toMatch(/website/);
    expect(v.sharpen.join(" ")).toMatch(/commercial registration/);
    expect(v.sharpen.join(" ")).toMatch(/VAT/);
    expect(v.sharpen.join(" ")).toMatch(/1 more RFQ/);
    expect(v.sharpen.join(" ")).toMatch(/web research/);
    expect(v.sharpen.length).toBeLessThanOrEqual(5);
  });

  it("web research that found nothing is a finding, not a pass: still unverified, and it says nothing was found", () => {
    const v = verdictOf(SID.tihama, web([]));
    expect(v.verdict).toBe("unverified");
    expect(v.sentence).toMatch(/nothing was found on the web/);
    expect(v.sharpen.join(" ")).toMatch(/company profile and registration certificate/);
  });

  it("a clean record with no history and no web evidence is never 'looks genuine'", () => {
    expect(verdictOf(SID.sahra).verdict).toBe("unverified");
  });

  it("looks genuine needs evidence: a consistent record plus a track record of answering and winning", () => {
    const v = verdictOf(SID.wadi);
    expect(v.verdict).toBe("looks_genuine");
    expect(v.positives.map((p) => p.kind)).toEqual(expect.arrayContaining(["history", "domain", "ids_format"]));
    expect(v.sentence).toMatch(/^Looks genuine/);
    expect(v.sentence).toMatch(/not a guarantee/);
  });

  it("looks genuine also follows cited pages that describe the company, even with a thin record", () => {
    const v = verdictOf(SID.tihama, web([fact("years", "Founded in 2008"), fact("client", "Supplied a named client")]));
    expect(v.verdict).toBe("looks_genuine");
    expect(v.positives.some((p) => p.kind === "web")).toBe(true);
  });

  it("a medium signal turns an otherwise good supplier into 'check first'", () => {
    const v = verdictOf(SID.wadi, emptyReputation(), (i) => ({ ...i, email: "sales@somewhereelse.com" }));
    expect(v.verdict).toBe("check_first");
    expect(v.sentence).toMatch(/^Check first: the email address is on somewhereelse\.com/);
  });

  it("mixed reviews make it 'check first'; one cited page reporting a serious matter makes it concerning", () => {
    expect(verdictOf(SID.wadi, web([fact("years", "Founded 2008"), fact("review_negative", "Late deliveries reported", "2025-06")])).verdict).toBe("check_first");
    const serious = verdictOf(SID.wadi, web([fact("years", "Founded 2008"), fact("blacklist", "Listed by a ministry", "2025-06")]));
    expect(serious.verdict).toBe("concerning");
    expect(serious.sentence).toMatch(/a cited page reports listed or sanctioned \(see the sources\)/);
    expect(serious.sentence).not.toMatch(/fraud|scam/i);
  });

  it("sentiment is worked out in code: serious is negative, balanced is mixed, good only is positive, nothing is unknown", () => {
    expect(sentimentOf([fact("insolvency", "x", "2025")])).toBe("negative");
    expect(sentimentOf([fact("years"), fact("news_adverse", "x", "2025")])).toBe("mixed");
    expect(sentimentOf([fact("years"), fact("client")])).toBe("positive");
    expect(sentimentOf([fact("news_adverse", "a", "2025"), fact("review_negative", "b")])).toBe("negative");
    expect(sentimentOf([])).toBe("unknown");
  });
});
