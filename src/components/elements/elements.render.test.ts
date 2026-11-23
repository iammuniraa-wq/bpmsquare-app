import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/contract-projects/p1",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import ElementPanel from "./ElementPanel";
import ElementsSettingsSection from "@/app/(app)/settings/contract-projects/ElementsSettingsSection";
import type { BuildingsData } from "@/lib/elements/clientTypes";
import type { ElementLineRow } from "@/lib/elements/rows";
import { buildingsView } from "@/lib/elements/buildings";

// The buildings and elements screens (bpmsquarecore 6b, 6c): a server render of the real panel with sample data, and the layout rules read from the
// markup and the source: one column under 900 px, 44 px targets, no hard-coded colour, no explanation printed as running text.

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const strip = (s: string) => s.replace(/<!-- -->/g, "");

const row = (over: Partial<ElementLineRow> = {}): ElementLineRow => ({
  key: "k1", line_no: 1, ref: "1.1", description: "Hollow core slab 200", unit: "m2", qty: 100, client_qty: 100, model_qty: 106, element_type: "HCS", element_code: "B01-HCS-0001",
  building_code: "B01", building_name: "Block one", is_category: false, uses: "client", variance_qty: 6, variance_pct: 6, band: "over", outside_pattern: false, mixed: false, ...over,
});
const data = (over: Partial<BuildingsData> = {}): BuildingsData => ({
  view: buildingsView([], [], 5), rows: [row()], issuable: 0, untyped: 0, enabled: true, scope: "project", pending: false,
  settings: { pattern: "{building}-{type}-{seq:4}", code_max: 20, qty_tolerance_pct: 5, level_names: { building: "Building", activity: "Activity", cost_element: "Cost element" } },
  pattern: "{building}-{type}-{seq:4}", pattern_frozen: false, types: [{ code: "HCS", name: "Hollow core slab" }, { code: "WAL", name: "Wall panel" }],
  revision: { id: "r1", rev_no: 0, status: "draft" }, lock: null, structure_open: true, can_reissue: true, allocation_basis: "line", currency: "SAR", ...over,
});
const panel = (d: BuildingsData, r: ElementLineRow, canEdit = true) => strip(renderToString(createElement(ElementPanel, { root: "/api/contract-projects/p1", data: d, row: r, canEdit, onClose: () => {}, onSaved: () => {} })));

describe("the element panel", () => {
  it("shows the type, the code, the client and model quantities, the Budget uses chip and the variance, with the actions to settle which the budget carries", () => {
    const html = panel(data(), row());
    for (const t of ["Element type", "Element code", "Model quantity", "Budget uses: Client", "Over tolerance", "Use the model quantity", "Use the client quantity"]) expect(html, t).toContain(t);
    expect(html).toContain("B01-HCS-0001");
    expect(html).toContain('data-guide="elements.panel.quantities"');
    expect(html).toContain("Hollow core slab");
  });

  it("a locked budget says why and offers no change; a view-only person is told", () => {
    const locked = panel(data({ lock: "An approved budget is locked. Start a revision to change an element, with a reason." }), row());
    expect(locked).toContain("An approved budget is locked");
    expect(locked).toMatch(/<select[^>]*disabled/);
    expect(locked).not.toContain('data-guide="elements.panel.accept"');
    expect(panel(data(), row(), false)).toContain("You can view this record but not change it");
  });

  it("an element with no code and a building offers Issue code; one with no building says to put it in a building first; a split line explains why it has no code", () => {
    expect(panel(data(), row({ element_code: null }))).toContain('data-guide="elements.panel.issue"');
    expect(panel(data(), row({ element_code: null, building_code: null, building_name: null }))).toContain("Put the line in a building first");
    expect(panel(data(), row({ element_code: null, mixed: true }))).toContain("split across buildings");
  });

  it("a client's own code outside the pattern is an amber chip with its explanation behind an i, not a paragraph", () => {
    const html = panel(data(), row({ outside_pattern: true }));
    expect(html).toContain("Outside pattern");
    expect(html).not.toContain("is kept exactly as typed");
  });

  it("a tender has no budget quantity and no accept buttons", () => {
    const html = panel(data({ scope: "tender", revision: null }), row());
    expect(html).not.toContain("Budget uses");
    expect(html).not.toContain("Use the model quantity");
  });
});

describe("the settings section", () => {
  it("renders nothing until its settings are read (a workspace without the add-on never gets them)", () => {
    expect(renderToString(createElement(ElementsSettingsSection))).toBe("");
  });
});

describe("the layout rules (6b): PC and a 375 px phone", () => {
  const css = read("src/components/elements/Buildings.module.css");
  it("is one column under 900 px, with the building rows and the element table becoming cards and the table header dropping out", () => {
    expect(css).toMatch(/@media \(max-width: 900px\)/);
    const phone = css.slice(css.indexOf("@media (max-width: 900px)"));
    for (const rule of [".row", ".headRow, .ehead", ".erow", ".form", ".two", ".mrow"]) expect(phone, rule).toContain(rule);
    expect(phone).toMatch(/\.headRow, \.ehead \{ display: none; \}/);
    expect(phone).toMatch(/\.form \{ grid-template-columns: 1fr; \}/);
  });
  it("never scrolls sideways: nothing has a fixed width wider than the screen, and every row cell can shrink", () => {
    expect(css).not.toMatch(/overflow-x:\s*scroll/);
    expect(css).toMatch(/\.cell \{[^}]*min-width: 0/);
  });
  it("uses no hard-coded colour anywhere: theme variables only", () => {
    const sources = ["src/components/elements/Buildings.module.css", "src/components/elements/BuildingsPanel.tsx", "src/components/elements/ElementPanel.tsx", "src/components/elements/ModelComparison.tsx", "src/app/(app)/settings/contract-projects/ElementsSettingsSection.tsx"];
    for (const f of sources) expect(read(f), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it("every tap target on the screens is 44 px tall", () => {
    for (const f of ["src/components/elements/BuildingsPanel.tsx", "src/components/elements/ModelComparison.tsx", "src/components/elements/ElementPanel.tsx"]) {
      const src = read(f);
      const buttons = src.match(/<Button\b[^>]*>/g) ?? [];
      for (const b of buttons) expect(b, `${f}: ${b.slice(0, 80)}`).toMatch(/minHeight: 44/);
    }
    expect(read("src/components/elements/Buildings.module.css")).toMatch(/\.toggle \{[^}]*min-height: 44px/);
  });
  it("has no console output and carries a guide id on its controls", () => {
    for (const f of ["BuildingsPanel.tsx", "ElementPanel.tsx", "ModelComparison.tsx"]) {
      const src = read(`src/components/elements/${f}`);
      expect(src).not.toContain("console.");
      expect(src).toContain("data-guide=");
    }
  });
});
