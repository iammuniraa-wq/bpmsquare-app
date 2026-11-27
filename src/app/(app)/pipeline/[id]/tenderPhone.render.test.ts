import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { TenderView } from "@/lib/tender/views";
import { tabHref } from "@/lib/tender/tabs";

// KAMCO test, 2026-11-27: GEN-02 (a tab click writes ?tab= so a reload and a shared link land on it) and TND-04 (the bid-decision chip is
// one line on a phone, and the assistant's round button never sits on the Next row).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/pipeline/x",
}));

import BidDecisionMarker from "./BidDecisionMarker";

const ROOT = path.resolve(__dirname, "../../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const clean = (h: string) => h.replace(/<!-- -->/g, "");

describe("GEN-02: the tender page keeps its tab in the URL", () => {
  it("tabHref sets ?tab= and keeps the rest of the path and query", () => {
    expect(tabHref("https://x.test/pipeline/abc", "costing")).toBe("/pipeline/abc?tab=costing");
    expect(tabHref("https://x.test/pipeline/abc?tab=boq", "bid")).toBe("/pipeline/abc?tab=bid");
    expect(tabHref("https://x.test/pipeline/abc?x=1#top", "room")).toBe("/pipeline/abc?x=1&tab=room#top");
  });

  it("a BOQ filter or open row belongs to the BOQ tab and goes when another tab opens", () => {
    expect(tabHref("https://x.test/pipeline/abc?tab=boq&boqfilter=unpriced&row=r1", "costing")).toBe("/pipeline/abc?tab=costing");
    expect(tabHref("https://x.test/pipeline/abc?tab=costing&boqfilter=unpriced", "boq")).toBe("/pipeline/abc?tab=boq&boqfilter=unpriced");
  });

  it("every tab change on the page goes through one setter that replaces the URL (no new history entry)", () => {
    const src = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(src).toContain("const [tab, setTabState] = useState<Tab>");
    expect(src).toMatch(/function setTab\(next: Tab\) \{\s*setTabState\(next\);\s*try \{ window\.history\.replaceState\(window\.history\.state, "", tabHref\(window\.location\.href, next\)\)/);
    const withoutSetter = src.replace(/function setTab\(next: Tab\) \{[\s\S]*?\r?\n  \}\r?\n/, "");
    expect(withoutSetter).not.toContain("setTabState(");
    expect(src).not.toMatch(/history\.pushState/);
  });
});

describe("TND-04: the bid-decision chip and the assistant button on a phone", () => {
  const tender = { decision: "go" } as unknown as TenderView;
  const html = clean(renderToString(createElement(BidDecisionMarker, { opportunityId: "o", tender, approval: null, onError: () => {}, onNotice: () => {} } as never)));

  it("the chip is one row that never wraps: the label and the line after it sit side by side and clip with an ellipsis", () => {
    const button = html.slice(html.indexOf("<button"), html.indexOf("</button>"));
    expect(button).toContain("Bid decision: Go");
    expect(button).toContain("recorded");
    expect(button).toMatch(/flex-direction:row/);
    expect(button).not.toMatch(/flex-direction:column/);
    expect(button).toMatch(/white-space:nowrap/);
    expect(button).toMatch(/text-overflow:ellipsis/);
    expect(button).toMatch(/min-height:44px/);
  });

  it("the Next row keeps clear of the strip the assistant's round button occupies on a phone", () => {
    const css = read("src/components/tender/TenderStepper.module.css").replace(/\s+/g, " ");
    expect(css).toMatch(/@media \(max-width: 899px\) \{ \.next \{ padding-right: calc\(14px \+ 66px\); \} \}/);
    const dock = read("src/components/AIDock.tsx");
    expect(dock).toMatch(/position: "fixed", right: 22, bottom: at\(20\)/);
    expect(dock).toMatch(/width: 52, height: 52/);
  });
});
