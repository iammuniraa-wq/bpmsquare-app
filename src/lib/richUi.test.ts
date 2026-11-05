import { describe, expect, it } from "vitest";
import { RICH_NAV_KEY, applyRichRoot, parseRichNav } from "./richUi";

describe("navigation style", () => {
  it("defaults to the menu and only a stored 'rail' selects the rail", () => {
    expect(parseRichNav(null)).toBe("menu");
    expect(parseRichNav(undefined)).toBe("menu");
    expect(parseRichNav("garbage")).toBe("menu");
    expect(parseRichNav("rail")).toBe("rail");
    expect(parseRichNav("menu")).toBe("menu");
    expect(RICH_NAV_KEY).toBe("bpm-rich-nav");
  });
});

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
