import { describe, expect, it } from "vitest";
import { applyRichRoot } from "./richUi";

describe("applyRichRoot", () => {
  const fake = () => {
    const attrs = new Map<string, string>();
    return { attrs, setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
  };

  it("mirrors the Rich facts onto the root while on, and clears them when off", () => {
    const el = fake();
    applyRichRoot(el, true, false);
    expect([...el.attrs]).toEqual([["data-rich-root", "true"]]);
    applyRichRoot(el, true, true);
    expect(el.attrs.get("data-rich-dark")).toBe("true");
    applyRichRoot(el, true, false);
    expect(el.attrs.has("data-rich-dark")).toBe(false);
    applyRichRoot(el, false, true);
    expect(el.attrs.size).toBe(0);
  });
});
