import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { WebConsentRow, WebSources } from "./WebResearch";

// The three web states in the dock: the consent chips, the settled line, and the sources under a web answer.

const consent = (state: Parameters<typeof WebConsentRow>[0]["state"], over: Partial<Parameters<typeof WebConsentRow>[0]> = {}) =>
  renderToString(createElement(WebConsentRow, { query: 'Tesla Germany company website', state, onChoice: () => {}, ...over }));

describe("the consent row", () => {
  it("shows the query verbatim with Yes and No only, and the explanation behind an i", () => {
    const out = consent("pending");
    expect(out).toContain("Search the web?");
    expect(out).toContain("Tesla Germany company website");
    for (const label of ["Yes", "No"]) expect(out).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    expect(out).toContain('aria-label="About web search"');
    expect(out).not.toMatch(/always/i);
    // The explanation is not printed as running text.
    expect(out).not.toContain("only about companies");
  });

  it("the two choices are chips of the dock's one chip pattern, at least 44 px high on a phone (class carries the rule)", () => {
    expect((consent("pending").match(/class="bms-dock-chip"/g) ?? []).length).toBe(2);
  });

  it("disables the chips while a request is in flight", () => {
    expect((consent("pending", { disabled: true }).match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it("once answered it shrinks to one line and offers no buttons", () => {
    for (const [state, line] of [["yes", "Searched the web for this"], ["no", "Not searched"], ["skipped", "Not searched"]] as const) {
      const out = consent(state);
      expect(out).toContain(line);
      expect(out).not.toContain("<button");
    }
  });

  it("escapes the query: a query is text, never markup", () => {
    expect(consent("pending", { query: '<img src=x onerror=alert(1)>' })).not.toContain("<img");
  });
});

describe("the sources under a web answer", () => {
  const src = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Source ${i + 1}`, url: `https://s${i + 1}.example/page` }));

  it("labels the answer 'From the web' and links each source in a new tab, numbered like the [n] markers", () => {
    const out = renderToString(createElement(WebSources, { sources: src(2) }));
    expect(out).toContain("From the web");
    expect(out).toContain("[1]");
    expect(out).toContain("[2]");
    expect(out).toContain('href="https://s1.example/page"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('aria-label="About');
  });

  it("shows a few rows and 'Show all' for a long list (rule 6b)", () => {
    const out = renderToString(createElement(WebSources, { sources: src(6) }));
    expect(out).toContain("Source 3");
    expect(out).not.toContain("Source 4");
    expect(out).toContain("Show all 6");
  });

  it("renders nothing without sources", () => {
    expect(renderToString(createElement(WebSources, { sources: [] }))).toBe("");
  });
});
