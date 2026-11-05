import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import Sparkline, { sparklinePath } from "./Sparkline";

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToString(el);

describe("Sparkline", () => {
  it("ends on the latest value, high values near the top", () => {
    const { d, last } = sparklinePath([1, 2, 3, 10], 100, 40);
    expect(d.startsWith("M4.0 ")).toBe(true);
    expect(last.x).toBe(96);
    expect(last.y).toBe(4);
  });

  it("is a flat line, never an empty path, with fewer than two points", () => {
    expect(sparklinePath([], 100, 40).d).toBe("M4 20 L96 20");
    expect(sparklinePath([5, Number.NaN], 100, 40).d).toBe("M4 20 L96 20");
  });

  it("is decorative without a label and described with one", () => {
    expect(html(createElement(Sparkline, { values: [1, 2, 3] }))).toContain('aria-hidden="true"');
    const out = html(createElement(Sparkline, { values: [1, 2, 3], label: "Up 12 percent over 30 days", tone: "good" }));
    expect(out).toContain('role="img"');
    expect(out).toContain("var(--rich-good");
  });
});
