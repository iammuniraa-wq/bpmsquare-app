import { describe, expect, it, vi } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/settings/estimate-templates",
}));

import RateSheetPanel from "./RateSheetPanel";
import { DoneView, PAGE, PreviewStep, StartStep } from "./RateSheetViews";
import { planRows } from "@/lib/estimator/rateSheet/plan";
import type { CatalogueProduct, PlanContext } from "@/lib/estimator/rateSheet/plan";
import type { RateRow } from "@/lib/estimator/rateSheet/parse";
import { defaultChoices } from "@/lib/estimator/rateSheet/view";
import type { ApplyView, PreviewView } from "@/lib/estimator/rateSheet/view";
import { RATE_SHEET_TIPS } from "@/lib/estimator/rateSheet/tips";

// The rate-sheet panel renders with the right things on it and none of its explanations printed (6b). A server render of the real views
// with sample data; the layout rules (one column at any width, 44 px controls, long text wrapping instead of scrolling sideways, the
// panel a bottom sheet under 780 px) are read from the markup and the source, since this environment has no browser.

const ROOT = path.resolve(__dirname, "../../../../..");
const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const strip = (s: string) => s.replace(/<!-- -->/g, "");
const html = (e: ReactElement) => strip(renderToString(e));
const noop = () => undefined;

const CTX: PlanContext = { today: "2026-10-26", sheet_date: "2026-10-26", currency: "SAR", validity_days: 180 };
const prod = (id: string, name: string, sku: string, uom: string, cost: number, illustrative = false): CatalogueProduct => ({
  id, name, sku, uom, cost_price: cost, cost_price_as_of: null, description: null, custom_data: illustrative ? { illustrative: true } : null, status: "active",
});
const PRODUCTS = [prod("00000000-0000-4000-8000-000000000001", "Steel pipe DN300 (illustrative)", "EST-PIPE-STEEL-300", "m", 340, true), prod("00000000-0000-4000-8000-000000000002", "Isolation valve DN300", "EST-VLV-300", "nr", 3100)];
const row = (n: number, name: string, over: Partial<RateRow> = {}): RateRow => ({
  row_no: n, name, sku: null, uom: null, rate: 100, currency: null, supplier: null, note: null, as_of: null, date_unreadable: false, currency_unreadable: false, ...over,
});

function viewOf(rows: RateRow[]): PreviewView {
  const planned = planRows(rows, PRODUCTS, CTX);
  return {
    file: "gulf.xlsx", sheet: "Prices", header_row: 2, columns: [], today: CTX.today, sheet_date: CTX.sheet_date, currency: "SAR", validity_days: 180,
    rows: planned, skipped: [], skipped_total: 3, truncated: false,
    counts: {
      rows: planned.length, ready: planned.filter((r) => r.default_action === "update").length,
      needs_choice: planned.filter((r) => r.default_action === "skip" && r.status !== "blocked" && r.status !== "duplicate").length,
      not_applied: planned.filter((r) => r.status === "blocked" || r.status === "duplicate").length, stale: planned.filter((r) => r.stale).length,
    },
  };
}
const SAMPLE = viewOf([
  row(3, "Steel pipe DN300", { sku: "EST-PIPE-STEEL-300", uom: "m", rate: 355.5, as_of: "2026-01-01" }),
  row(4, "Isolation valve", { uom: "nr", rate: 3200 }),
  row(5, "Stainless kitchen sink", { sku: "SNK-1", rate: 900 }),
  row(6, "Steel pipe DN300", { rate: 1, currency: "EUR" }),
]);

const step = (over: Partial<Parameters<typeof PreviewStep>[0]> = {}) =>
  html(el(PreviewStep, { view: SAMPLE, choices: defaultChoices(SAMPLE.rows), onChoices: noop, filter: "choose", onFilter: noop, shown: PAGE, onShown: noop, ...over }));

describe("step 1: choose the file", () => {
  const out = html(el(StartStep, { asOf: "2026-10-26", onAsOf: noop, onFile: noop }));
  it("offers a file, the as-of date and the starter list, each findable by the assistant", () => {
    expect(out).toContain('type="file"');
    expect(out).toContain('accept=".xlsx,.xlsm,.csv,.txt"');
    expect(out).toContain('type="date"');
    expect(out).toContain('value="2026-10-26"');
    for (const id of ["rate.sheet.start", "rate.sheet.file", "rate.sheet.asof", "rate.sheet.starter"]) expect(out, id).toContain(`data-guide="${id}"`);
    expect(out).toContain("/api/estimate-templates/rate-sheet");
    expect(out).toContain("Download the starter item list");
  });
  it("prints none of the explanations; each is behind an i", () => {
    for (const tip of [RATE_SHEET_TIPS.file, RATE_SHEET_TIPS.asOf, RATE_SHEET_TIPS.starterList]) expect(out).not.toContain(tip);
    expect(out).toContain("About File");
    expect(out).toContain("About Prices as of");
    expect(out).toContain("About Starter item list");
  });
});

describe("step 2: the preview", () => {
  it("opens on the rows that need a choice, with the counts on the tabs", () => {
    const out = step();
    expect(out).toContain("4 items");
    expect(out).toContain("Need a choice (2)");
    expect(out).toContain("Ready (1)");
    expect(out).toContain("Not applied (1)");
    expect(out).toContain("All (4)");
    expect(out).toContain("Stainless kitchen sink");
    expect(out).not.toContain(">Steel pipe DN300<");   // that row is in Ready
    expect(out).toContain("Add every unmatched item as new");
    expect(out).toContain("3 lines were not items");
    for (const id of ["rate.sheet.summary", "rate.sheet.filter", "rate.sheet.rows", "rate.sheet.row", "rate.sheet.choice", "rate.sheet.add_all"]) expect(out, id).toContain(`data-guide="${id}"`);
  });

  it("each row says how well it matched, what it is worth, and offers update, add or skip", () => {
    const out = step({ filter: "all" });
    expect(out).toContain("Exact match");
    expect(out).toContain("Possible match");
    expect(out).toContain("No match");
    expect(out).toContain("355.5");
    expect(out).toContain("900");
    expect(out).toContain("Update Steel pipe DN300 (illustrative) (EST-PIPE-STEEL-300)");
    expect(out).toContain("Add as a new item");
    expect(out).toContain(">Skip<");
    expect(out).toContain("Now 340, no date · illustrative placeholder");
  });

  it("a stale price is labelled with its age; a price in another currency is shown as not applied, with the reason, and has no choice", () => {
    const out = step({ filter: "all" });
    expect(out).toContain("stale, 298 days old");
    expect(out).toContain("1 stale");
    const blocked = step({ filter: "not_applied" });
    expect(blocked).toContain("Not applied");
    expect(blocked).toContain("The sheet is in EUR; this workspace works in SAR. Convert the rate first.");
    expect(blocked).toContain('role="alert"');
    expect(blocked).not.toContain("<select");
  });

  it("prints none of the explanations", () => {
    const out = step({ filter: "all" });
    for (const tip of [RATE_SHEET_TIPS.match, RATE_SHEET_TIPS.choice, RATE_SHEET_TIPS.stale, RATE_SHEET_TIPS.currency, RATE_SHEET_TIPS.history]) expect(out).not.toContain(tip);
    expect(out).toContain("About Matching");
    expect(out).toContain("About What to do");
    expect(out).toContain("About Stale prices");
  });

  it("a long list shows a page and 'show more'", () => {
    const many = viewOf(Array.from({ length: 60 }, (_, i) => row(i + 3, `Unknown item ${i}`, { sku: `U-${i}` })));
    const out = step({ view: many, filter: "choose" });
    expect((out.match(/data-guide="rate\.sheet\.row"/g) ?? []).length).toBe(PAGE);
    expect(out).toContain(`Show ${PAGE} more of 35`);
    expect(step({ view: many, filter: "choose", shown: 60 })).not.toContain("more of");
  });

  it("an empty group says so", () => {
    expect(step({ view: viewOf([row(3, "Stainless kitchen sink")]), filter: "not_applied" })).toContain("Nothing here.");
  });
});

describe("step 3: the result", () => {
  const done = (over: Partial<ApplyView["summary"]> = {}): ApplyView => ({
    summary: { updated: 12, added: 3, unchanged: 1, skipped: 5, errors: 1, stale: 2, ...over },
    notes: [{ row_no: 9, name: "Pipe", outcome: "error", message: "That item is not in this catalogue.", stale: false }],
    validity_days: 180,
  });
  it("says what was done in one line, the stale count, and every row that was not done", () => {
    const out = html(el(DoneView, { done: done() }));
    expect(out).toContain("12 updated · 3 added · 1 already had it · 5 skipped · 1 not done");
    expect(out).toContain("2 imported as stale");
    expect(out).toContain("Row 9, Pipe: That item is not in this catalogue.");
    expect(out).toContain('role="alert"');
  });
  it("says so when nothing changed", () => {
    expect(html(el(DoneView, { done: { ...done({ updated: 0, added: 0, unchanged: 0, skipped: 0, errors: 0, stale: 0 }), notes: [] } }))).toContain("Nothing changed");
  });
});

describe("the panel", () => {
  const out = html(el(RateSheetPanel, { onClose: noop, onDone: noop }));
  it("opens as a dialog on the first step with the one primary action disabled until a file is chosen", () => {
    expect(out).toContain('role="dialog"');
    expect(out).toContain("Import rate sheet");
    expect(out).toContain('data-guide="rate.sheet.read"');
    expect(out).toMatch(/<button[^>]*disabled[^>]*data-guide="rate\.sheet\.read"|<button[^>]*data-guide="rate\.sheet\.read"[^>]*disabled/);
  });
});

describe("375 px and PC", () => {
  const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
  const views = read("src/app/(app)/settings/estimate-templates/RateSheetViews.tsx");
  const panel = read("src/app/(app)/settings/estimate-templates/RateSheetPanel.tsx");
  const list = read("src/app/(app)/settings/estimate-templates/TemplatesListClient.tsx");

  it("every control is 44 px tall and nothing is wider than a phone", () => {
    expect((views.match(/minHeight: 44/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect((panel.match(/minHeight: 44/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(views).not.toMatch(/width: \d{3,}/);
    expect(views).not.toMatch(/overflow-?x|overflowX/i);
    expect(views).not.toMatch(/gridTemplateColumns/);   // one column at any width
  });
  it("long names and notes wrap instead of scrolling sideways", () => {
    expect((views.match(/overflowWrap: "anywhere"/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(views).toMatch(/minWidth: 0/);
  });
  it("the panel is a drawer on a PC and a bottom sheet under 780 px, with the primary action in the footer", () => {
    const css = read("src/components/ui/SidePanel.module.css");
    expect(css).toMatch(/@media \(max-width: 780px\)/);
    expect(css).toMatch(/max-height: 90vh/);
    expect(css).toMatch(/\.body \{[^}]*overflow-y: auto/);
    expect(panel).toContain("footer={footer}");
  });
  it("the list page has the Import rate sheet button, the illustrative count, and one button for the new starters", () => {
    expect(list).toContain('data-guide="rate.sheet.open"');
    expect(list).toContain('data-guide="rate.sheet.illustrative"');
    expect(list).toContain('data-guide="rate.sheet.add_starters"');
    expect(list).toContain("RATE_SHEET_TIPS.illustrative");
  });
});
