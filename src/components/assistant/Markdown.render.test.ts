import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineMarkdown, Markdown } from "./Markdown";

// What the person's browser is given for the assistant's text: real elements for real markdown, escaped text for
// everything else, and no path for markup of the model's own (hostile text included).

const md = (text: string, links?: boolean) => renderToStaticMarkup(createElement(Markdown, { text, links }));

describe("the markdown renderer", () => {
  it("draws bold, italic, code, lists and line breaks as elements, with no markers left", () => {
    const out = md("**Size:** 5 m\nline two\n\n- one\n- *two*\n\n1. first\n2. `second`");
    expect(out).toContain("<strong>Size:</strong>");
    expect(out).toContain("<br/>");
    expect(out).toContain("<ul");
    expect(out).toContain("<em>two</em>");
    expect(out).toContain("<ol");
    expect(out).toContain("<code");
    expect(out).not.toContain("**");
    expect(out).not.toMatch(/(^|>)\s*[-*] /);
  });

  it("escapes HTML instead of injecting it", () => {
    const out = md('<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a> &lt;b&gt;');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toMatch(/<a [^>]*javascript/i);
    expect(out).toContain("&lt;script&gt;");
    expect(out).toContain("&amp;lt;b&amp;gt;");
  });

  it("a javascript:, data: or http: link keeps its label as plain text and has no href at all", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,x", "http://plain.example/", "vbscript:x"]) {
      const out = md(`[open it](${url})`);
      expect(out, url).toContain("open it");
      expect(out, url).not.toContain("href=");
    }
  });

  it("an https link opens in a new tab with noopener and noreferrer", () => {
    const out = md("[docs](https://example.com/a)");
    expect(out).toContain('href="https://example.com/a"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('target="_blank"');
  });

  it("text from the web gets no links at all", () => {
    const out = md("[Tesla](https://tesla.example/de) builds cars [1].", false);
    expect(out).not.toContain("href=");
    expect(out).toContain("Tesla builds cars [1].");
  });

  it("attribute breakouts in a link target do not become attributes", () => {
    const out = md('[x](https://a.example/" onmouseover="alert(1))');
    expect(out).not.toContain("onmouseover=");
  });

  it("unclosed and nested markers never print as markers", () => {
    const out = md("**a *b **c\n__d ~~e `f");
    expect(out).not.toMatch(/\*|__|~~|`/);
    expect(out).toContain("a b c");
  });

  it("a very long message renders and stays one bounded block", () => {
    const out = md(("word **bold** [x](https://a.example/) " + "\n").repeat(2000));
    expect(out.length).toBeGreaterThan(1000);
    expect(out).not.toContain("**");
  });

  it("fenced code is shown literally", () => {
    const out = md("```\n**raw** <b>\n```");
    expect(out).toContain("<pre");
    expect(out).toContain("**raw** &lt;b&gt;");
  });

  it("the inline form has no wrapper element and no links unless asked", () => {
    const out = renderToStaticMarkup(createElement(InlineMarkdown, { text: "Press **Save** [now](https://a.example/)" }));
    expect(out).toBe("Press <strong>Save</strong> now");
  });
});
