import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import CountUp, { countUpValue } from "./CountUp";

const createElement = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (el: ReactElement) => renderToString(el);

describe("CountUp", () => {
  it("renders the final number on the server, so reduced motion and no-JS see the truth", () => {
    expect(html(createElement(CountUp, { value: 1234 }))).toContain(">1,234<");
    expect(html(createElement(CountUp, { value: 7, format: (n: number) => `SAR ${Math.round(n)}` }))).toContain(">SAR 7<");
  });

  it("eases from the start to the end and clamps time", () => {
    expect(countUpValue(0, 100, 0)).toBe(0);
    expect(countUpValue(0, 100, 1)).toBe(100);
    expect(countUpValue(0, 100, 2)).toBe(100);
    expect(countUpValue(0, 100, -1)).toBe(0);
    expect(countUpValue(0, 100, 0.5)).toBeGreaterThan(50);
  });
});
