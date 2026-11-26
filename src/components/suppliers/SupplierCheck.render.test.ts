import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/suppliers/x",
}));

import SupplierCheckView, { CHECK_CSS } from "./SupplierCheckView";
import SupplierCheckPanel from "./SupplierCheckPanel";
import { SupplierCheckChip, Stars } from "./supplierCheckUi";
import { CHECK_TIPS } from "@/lib/suppliers/check/tips";
import { computeRating } from "@/lib/suppliers/check/rating";
import { computeSignals } from "@/lib/suppliers/check/signals";
import { combineVerdict } from "@/lib/suppliers/check/verdict";
import { emptyReputation } from "@/lib/suppliers/check/reputation";
import { NOW, SID, history, identity, othersOf } from "@/lib/suppliers/check/fixtures";
import type { SupplierCheckResult } from "@/lib/suppliers/check/types";
import type { DockSupplierCheck } from "@/lib/assistant/supplierCheck/tool";

// The Supplier check card renders with the right things on it and none of its explanations printed (6b), and the demo-style supplier
// with thin history still reads honestly. A server render of the real components. The two widths (375 px and PC) are decided by the
// rules in the component's own style block, which this test reads: one column under 900 px and every control at least 44 px tall.

function resultFor(id: string): SupplierCheckResult {
  const findings = computeSignals(identity(id), othersOf(id), { now: NOW });
  const rating = computeRating({ supplierId: id, now: NOW, ...history() });
  const reputation = emptyReputation();
  const v = combineVerdict({ findings, rating, reputation, hasWebsite: !!identity(id).website, hasCr: !!identity(id).cr, hasTaxId: !!identity(id).taxId });
  return { supplierId: id, supplierName: identity(id).name, checkedAt: NOW.toISOString(), verdict: v.verdict, verdictSentence: v.sentence, findings: { signals: findings.signals, positives: v.positives }, rating, reputation, sharpen: v.sharpen, model: null };
}

const html = (r: SupplierCheckResult) => renderToString(createElement(SupplierCheckView, { result: r })).replace(/<!-- -->/g, "");

describe("the Supplier check body", () => {
  it("a supplier with strong history shows its verdict, stars, the rating and what it rests on", () => {
    const h = html(resultFor(SID.wadi));
    expect(h).toContain("Looks genuine");
    expect(h).toContain("4.8");
    expect(h).toContain("from 6 RFQs in 24 months");
    expect(h).toContain("Our rating");
    expect(h).toContain("Market reputation");
    expect(h).toContain("Not researched");
    expect(h).toContain("How the rating is worked out");
    expect(h).toContain("Rating = 5 x the weighted average");
  });

  it("the demo-style supplier says 'Could not verify', 'Not enough history' with the sample size, and what would sharpen the result", () => {
    const h = html(resultFor(SID.tihama));
    expect(h).toContain("Could not verify");
    expect(h).toContain("Not enough history");
    expect(h).toContain("2 of 3 RFQs needed");
    expect(h).toContain("What would sharpen this result");
    expect(h).toContain("Add the company website");
    expect(h).not.toMatch(/fraud|scam/i);
  });

  it("a duplicate bank account shows as serious, names the other supplier with a link, and prints no bank number", () => {
    const h = html(resultFor(SID.najd));
    expect(h).toContain("Concerning");
    expect(h).toContain("Serious");
    expect(h).toContain(`href="/suppliers/${SID.arkan}"`);
    expect(h).toContain("Arkan Waterproofing Systems");
    expect(h).not.toMatch(/SA44/);
    expect(h).toContain("risk indicator, not a legal finding");
  });

  it("keeps the explanations behind the 'i': the tip texts are not printed as running text, only the verdict sentence's own caveat", () => {
    const h = html(resultFor(SID.wadi));
    for (const t of [CHECK_TIPS.overall, CHECK_TIPS.verdict, CHECK_TIPS.rating, CHECK_TIPS.reputation]) expect(h).not.toContain(t);
    expect(h).toContain('aria-label="About the verdict"');
  });

  it("sections are collapsible, and one column with 44 px controls under 900 px", () => {
    const h = html(resultFor(SID.wadi));
    expect((h.match(/<details/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(CHECK_CSS).toMatch(/@media \(max-width: 900px\) \{ \.sc-tiles \{ grid-template-columns: 1fr; \}/);
    expect(CHECK_CSS).toMatch(/min-height: 44px/);
  });
});

describe("the chip and the stars", () => {
  it("draws nothing for a supplier that has not been checked", () => {
    expect(renderToString(createElement(SupplierCheckChip, { summary: null }))).toBe("");
  });

  it("draws the verdict and the rating, and says 'a risk indicator, not a legal finding' in its title", () => {
    const h = renderToString(createElement(SupplierCheckChip, { summary: { supplierId: SID.wadi, verdict: "looks_genuine", rating: 4.75, rfqs: 6, checkedAt: NOW.toISOString() } }));
    expect(h).toContain("Looks genuine");
    expect(h).toContain("4.8");
    expect(h).toContain("risk indicator, not a legal finding");
  });

  it("stars read as text for a screen reader, with and without a rating", () => {
    expect(renderToString(createElement(Stars, { value: 3.5 }))).toContain('aria-label="3.5 out of 5"');
    expect(renderToString(createElement(Stars, { value: null }))).toContain('aria-label="No rating yet"');
  });
});

describe("the card in the dock", () => {
  const seed = (over: Partial<DockSupplierCheck> = {}): DockSupplierCheck => ({
    supplierId: SID.tihama, name: "Tihama Geosynthetics", result: resultFor(SID.tihama), web: { searches: 7, consent: { id: "c1", token: "t" } }, saveToken: "s",
    lastSaved: null, notice: null, href: `/suppliers/${SID.tihama}`, digest: "d", ...over,
  });
  const panel = (s: DockSupplierCheck) => renderToString(createElement(SupplierCheckPanel, { supplierId: s.supplierId, seed: s })).replace(/<!-- -->/g, "");

  it("offers web research and saving as buttons; the consent question is not asked until the person asks for research", () => {
    const h = panel(seed());
    expect(h).toContain("Research on the web");
    expect(h).toContain("Save to supplier");
    expect(h).not.toContain("Up to 7 searches");
    expect(h).toContain("Could not verify");
  });

  it("offers neither when this person may not spend or save", () => {
    const h = panel(seed({ web: null, saveToken: null }));
    expect(h).not.toContain("Research on the web");
    expect(h).not.toContain("Save to supplier");
  });

  it("says what is already saved", () => {
    expect(panel(seed({ lastSaved: { checkedAt: "2026-11-01T00:00:00.000Z", verdict: "check_first" } }))).toContain("last saved check: Check first");
  });
});

describe("the page behind the card follows a saved check (the header chip no longer reads 'Not checked')", () => {
  const src = readFileSync(path.join(__dirname, "SupplierCheckPanel.tsx"), "utf8");

  it("refreshes the server page after a run that saved and after the dock's Save to supplier, and nowhere else", () => {
    expect(src).toContain('import { useRouter } from "next/navigation"');
    expect(src).toMatch(/await load\(\);\s*if \(j\.saved === true\) router\.refresh\(\);/);
    expect(src).toMatch(/setSaved\(true\); setSaveToken\(null\); router\.refresh\(\);/);
    expect((src.match(/router\.refresh\(\)/g) ?? []).length).toBe(2);
  });

  it("the supplier page draws its header chip on the server from the newest saved check, so a refresh is what changes it", () => {
    const page = readFileSync(path.join(__dirname, "../../app/(app)/suppliers/[id]/page.tsx"), "utf8");
    expect(page).toContain("readSummaries(");
    expect(page).toContain("<SupplierCheckChip summary={latestCheck} />");
  });
});
