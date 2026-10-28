import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";

// Donut keeps one piece of state, the hovered label. It is replaced here by a value the test controls, so the markup for "nothing hovered"
// and "this slice hovered" can be compared, and the handlers can be read off the element tree and called.
const hover = vi.hoisted(() => ({ value: null as string | null, set: vi.fn() }));
vi.mock("react", async (orig) => {
  const real = await orig<typeof import("react")>();
  return { ...real, useState: (init: unknown) => (init === null ? [hover.value, hover.set] : real.useState(init as never)) };
});
vi.mock("next/link", () => ({ default: ({ children, ...rest }: Record<string, unknown>) => createElement("a", rest, children as ReactNode) }));

import Donut, { type DonutSlice } from "./Donut";

const SLICES: DonutSlice[] = [
  { label: "National Water", value: 34, color: "#111111", href: "/pipeline?tab=tenders&client=aaaaaaaa", ariaLabel: "National Water: 34M SAR, 3 tenders" },
  { label: "Roads Authority", value: 19, color: "#222222", href: "/pipeline?tab=tenders&client=bbbbbbbb" },
  { label: "Others", value: 7, color: "#333333", href: "/pipeline?tab=tenders" },
];
const html = (props: Partial<Parameters<typeof Donut>[0]> = {}) =>
  renderToString(createElement(Donut, { slices: SLICES, size: 150, thickness: 20, centerLabel: "SAR open", centerValue: "60.0M", formatValue: (v: number) => `${v}M`, ...props })).replace(/<!-- -->/g, "");

beforeEach(() => { hover.value = null; hover.set.mockClear(); });

/** Every element in a rendered tree, in order. */
function walk(node: ReactNode, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) node.forEach((n) => walk(n, out));
  else if (isValidElement(node)) { out.push(node as ReactElement<Record<string, unknown>>); walk((node.props as { children?: ReactNode }).children, out); }
  return out;
}

describe("the app's hover donut, with linked slices", () => {
  it("shows the total in the centre and every slice's wedge, with a real link on each wedge and each legend row", () => {
    const out = html();
    expect(out).toContain(">60.0M<");
    expect(out).toContain("SAR open");
    for (const s of SLICES) expect(out).toContain(`href="${(s.href as string).replace(/&/g, "&amp;")}"`);
    expect(out).toContain('aria-label="National Water: 34M SAR, 3 tenders"');
    expect(out).toContain('aria-label="Roads Authority: 19M, 32%"');
    expect((out.match(/class="donut-hit"/g) ?? []).length).toBe(3);
    expect((out.match(/class="donut-legend-row is-interactive"/g) ?? []).length).toBe(3);
    expect(out).not.toContain("is-hovered");
  });

  it("hovering a slice lifts its wedge, dims the others, and switches the centre readout to that slice", () => {
    hover.value = "Roads Authority";
    const out = html();
    expect(out).toContain("donut-slice is-hovered");
    expect((out.match(/class="donut-slice is-hovered"/g) ?? []).length).toBe(1);
    expect((out.match(/opacity="0.32"/g) ?? []).length).toBe(2);
    expect(out).toContain("translate(");
    expect(out).toContain(">19M<");
    expect(out).toContain("Roads Authority · 32%");
    expect(out).not.toContain(">60.0M<");
    // the legend: the hovered row is bold, the others fade
    expect(out).toContain("opacity:0.55");
    expect(out).toContain("font-weight:700");
  });

  it("each wedge and each legend row reports hover and keyboard focus for its own slice", () => {
    const tree = Donut({ slices: SLICES, size: 150, thickness: 20, centerValue: "60.0M" } as Parameters<typeof Donut>[0]) as ReactElement;
    const all = walk(tree);
    const wedgeLinks = all.filter((e) => e.props.className === "donut-hit");
    const legendLinks = all.filter((e) => typeof e.props.className === "string" && (e.props.className as string).startsWith("donut-legend-row"));
    expect(wedgeLinks).toHaveLength(3);
    expect(legendLinks).toHaveLength(3);
    SLICES.forEach((s, i) => {
      for (const el of [wedgeLinks[i], legendLinks[i]]) {
        expect(el.props.href).toBe(s.href);
        hover.set.mockClear();
        (el.props.onFocus as () => void)();
        expect(hover.set).toHaveBeenCalledWith(s.label);
        hover.set.mockClear();
        (el.props.onBlur as () => void)();
        expect(hover.set).toHaveBeenCalledWith(null);
      }
      // the hit wedge under the link carries the mouse handlers
      const hit = walk(wedgeLinks[i].props.children as ReactNode).find((e) => typeof e.props.onMouseEnter === "function")!;
      hover.set.mockClear();
      (hit.props.onMouseEnter as () => void)();
      expect(hover.set).toHaveBeenCalledWith(s.label);
      hover.set.mockClear();
      (hit.props.onMouseLeave as () => void)();
      expect(hover.set).toHaveBeenCalledWith(null);
      hover.set.mockClear();
      (legendLinks[i].props.onMouseEnter as () => void)();
      expect(hover.set).toHaveBeenCalledWith(s.label);
    });
  });

  it("a donut without links is drawn as before: no anchors, plain legend rows", () => {
    const out = html({ slices: SLICES.map(({ label, value, color }) => ({ label, value, color })) });
    expect(out).not.toContain("<a ");
    expect(out).not.toContain("donut-hit");
    expect(out).toContain('class="donut-legend-row"');
  });

  it("without a centre value it still shows the plain total", () => {
    expect(html({ centerValue: undefined })).toContain(">60M<");
  });
});
