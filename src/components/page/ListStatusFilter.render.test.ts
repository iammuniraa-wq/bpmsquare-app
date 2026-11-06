import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ListStatusFilter, { splitChips } from "./ListStatusFilter";
import type { ListChip } from "./ObjectListPage";

const chip = (id: string, label: string, active = false, kind?: ListChip["kind"]): ListChip => ({ id, label, href: `/x?status=${id}`, active, kind });
const html = (el: unknown) => renderToString(el as never).replace(/<!-- -->/g, "");

describe("the collapsible status filter", () => {
  const estimates = [chip("all", "All (18)", true), chip("draft", "Draft (7)"), chip("quoted", "Quoted (11)"), chip("won", "Won (0)"), chip("lost", "Lost (0)")];

  it("makes a donut out of statuses that add up to All, keeping All as a small pill", () => {
    const s = splitChips(estimates);
    expect(s.slices.map((i) => i.chip.id)).toEqual(["draft", "quoted", "won", "lost"]);
    expect(s.also.map((i) => i.chip.id)).toEqual(["all"]);
    expect(s.total).toBe(18);
  });

  it("does not draw a donut for chips that overlap, they stay a plain list of pills", () => {
    const cases = [chip("open", "Open (16)", true), chip("repair", "In repair (2)"), chip("wait", "Awaiting (1)"), chip("closed", "Closed (0)"), chip("all", "All (16)")];
    const s = splitChips(cases);
    expect(s.slices).toHaveLength(0);
    expect(s.also).toHaveLength(5);
  });

  it("follows what a list says about its own chips", () => {
    const rfqs = [chip("open", "Open (5)", true, "also"), chip("await", "Waiting on suppliers (2)", false, "slice"), chip("award", "Ready to award (3)", false, "slice"), chip("done", "Awarded (3)", false, "slice"), chip("all", "All (8)", false, "also")];
    const s = splitChips(rfqs);
    expect(s.slices.map((i) => i.chip.id)).toEqual(["await", "award", "done"]);
    expect(s.total).toBe(8);
  });

  it("is collapsed on first paint: one pill with the current filter, no panel", () => {
    const out = html(createElement(ListStatusFilter, { chips: estimates, enabled: true }));
    expect(out).toContain('aria-expanded="false"');
    expect(out).toContain("All (18)");
    expect(out).toContain("<svg");
    expect(out).not.toContain("bpm-sf__panel");
    expect(out).not.toContain("Quoted (11)");
  });

  it("keeps the old chip row where the donut is not switched on", () => {
    const out = html(createElement(ListStatusFilter, { chips: estimates, enabled: false }));
    expect(out).toContain("Quoted (11)");
    expect(out).not.toContain("aria-expanded");
  });

  it("copes with labels that carry no count", () => {
    const s = splitChips([chip("a", "New", true), chip("b", "Done")]);
    expect(s.slices).toHaveLength(0);
    expect(s.also).toHaveLength(2);
  });
});
