import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import Ring, { ringPercent } from "./Ring";

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToString(el);

describe("Ring", () => {
  it("draws the arc as the percentage itself and says it in words", () => {
    const out = html(createElement(Ring, { value: 72, label: "Account health" }, "72"));
    expect(out).toContain('aria-label="Account health: 72 percent"');
    expect(out).toContain('stroke-dashoffset="28"');
    expect(out).toContain('pathLength="100"');
    expect(out).toContain(">72<");
  });

  it("clamps and survives nonsense", () => {
    expect(ringPercent(140)).toBe(100);
    expect(ringPercent(-5)).toBe(0);
    expect(ringPercent(Number.NaN)).toBe(0);
  });

  it("takes its colour from tokens only, with a fallback to the app accent", () => {
    const out = html(createElement(Ring, { value: 40, label: "Risk", tone: "warm" }));
    expect(out).toContain("var(--rich-warm");
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});
