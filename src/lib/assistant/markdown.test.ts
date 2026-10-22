import { describe, expect, it } from "vitest";
import { MAX_MD_CHARS, parseInlineText, parseMarkdown, plainText, safeHttpsUrl, type Block, type Inline } from "./markdown";

// The markdown reader behind every assistant message in the dock (owner request 2026-10-22). It reads text into plain
// nodes; the dock draws them as React elements, so these tests are about WHAT is read, not about escaping (that is held
// by markdown.render.test.ts against the real renderer).

const inline = (t: string, links = true) => parseInlineText(t, { links });
const kinds = (nodes: Inline[]) => nodes.map((n) => n.t);
const text = (nodes: Inline[]): string => nodes.map((n) => (n.t === "text" || n.t === "code" ? n.v : text(n.c))).join("");

describe("emphasis and code", () => {
  it("reads bold, italic and inline code", () => {
    expect(inline("**Size:** 5 m")).toEqual([{ t: "bold", c: [{ t: "text", v: "Size:" }] }, { t: "text", v: " 5 m" }]);
    expect(inline("an *important* thing")).toEqual([{ t: "text", v: "an " }, { t: "italic", c: [{ t: "text", v: "important" }] }, { t: "text", v: " thing" }]);
    expect(inline("run `npm test` now")).toEqual([{ t: "text", v: "run " }, { t: "code", v: "npm test" }, { t: "text", v: " now" }]);
    expect(inline("__bold__ and _it_")).toEqual([{ t: "bold", c: [{ t: "text", v: "bold" }] }, { t: "text", v: " and " }, { t: "italic", c: [{ t: "text", v: "it" }] }]);
  });

  it("nests italic inside bold and bold inside italic", () => {
    expect(inline("**a *b* c**")).toEqual([{ t: "bold", c: [{ t: "text", v: "a " }, { t: "italic", c: [{ t: "text", v: "b" }] }, { t: "text", v: " c" }] }]);
    expect(inline("*a **b** c*")).toEqual([{ t: "italic", c: [{ t: "text", v: "a " }, { t: "bold", c: [{ t: "text", v: "b" }] }, { t: "text", v: " c" }] }]);
    expect(kinds(inline("***both***"))).toEqual(["bold"]);
  });

  it("code is literal: markers inside it are not read", () => {
    expect(inline("`**not bold**`")).toEqual([{ t: "code", v: "**not bold**" }]);
  });

  it("the real example from the dock: '**New Account**' and '**Size:**' lose their markers", () => {
    expect(plainText("**New Account**")).toBe("New Account");
    expect(plainText("- **Size:** 5 m")).toBe("- Size: 5 m");
  });
});

describe("stray markers are removed, not shown", () => {
  it("an unclosed ** or * or ` is dropped and its text kept", () => {
    expect(plainText("**unclosed bold")).toBe("unclosed bold");
    expect(plainText("half *open")).toBe("half open");
    expect(plainText("a ` stray tick")).toBe("a  stray tick");
    expect(plainText("closing only**")).toBe("closing only");
    expect(plainText("~~gone~~ text")).toBe("gone text");
  });

  it("mismatched and over-long runs are dropped", () => {
    expect(plainText("****")).toBe("");
    expect(plainText("**a* b")).not.toContain("*");
    expect(plainText("*****x*****")).toBe("x");
  });

  it("a lone asterisk between spaces and an underscore inside a word are just characters", () => {
    expect(plainText("3 * 4 = 12")).toBe("3 * 4 = 12");
    expect(plainText("use snake_case_names here")).toBe("use snake_case_names here");
    expect(plainText("a_b and c_d")).toBe("a_b and c_d");
  });

  it("an escaped marker is a character", () => {
    expect(plainText("price \\*net\\* only")).toBe("price *net* only");
  });

  it("unmatched markers never reach the output of a whole message", () => {
    const out = parseMarkdown("**Size:** big\n*Colour: red\n__Weight: 4 kg\n`code");
    expect(JSON.stringify(out)).not.toMatch(/\*|__|`/);
  });
});

describe("blocks", () => {
  it("bullet and numbered lists, with the number a numbered list starts at", () => {
    const b = parseMarkdown("Intro\n\n- one\n- **two**\n* three\n\n3. third\n4. fourth");
    expect(b.map((x) => x.t)).toEqual(["p", "ul", "ol"]);
    expect((b[1] as Extract<Block, { t: "ul" }>).items).toHaveLength(3);
    expect(b[2]).toMatchObject({ t: "ol", start: 3 });
    expect((b[2] as Extract<Block, { t: "ol" }>).items).toHaveLength(2);
  });

  it("consecutive lines of a paragraph are kept as line breaks", () => {
    const b = parseMarkdown("line one\nline two\nline three");
    expect(b).toHaveLength(1);
    expect((b[0] as Extract<Block, { t: "p" }>).lines).toHaveLength(3);
  });

  it("a heading becomes a bold line and a rule disappears", () => {
    const b = parseMarkdown("## Summary\n\n---\n\nbody");
    expect(b).toHaveLength(2);
    expect((b[0] as Extract<Block, { t: "p" }>).lines[0][0]).toMatchObject({ t: "bold" });
  });

  it("a fenced block is kept as literal text with its markers unread", () => {
    const b = parseMarkdown("before\n```\n**not bold**\n- not a list\n```\nafter");
    expect(b.map((x) => x.t)).toEqual(["p", "pre", "p"]);
    expect(b[1]).toEqual({ t: "pre", v: "**not bold**\n- not a list" });
  });

  it("an unclosed fence still ends at the end of the text", () => {
    expect(parseMarkdown("```\ncode")).toEqual([{ t: "pre", v: "code" }]);
  });

  it("a quote marker is removed; a dash with no space is not a bullet", () => {
    expect(parseMarkdown("> quoted")[0]).toMatchObject({ t: "p" });
    expect(parseMarkdown("-5 degrees")[0]).toMatchObject({ t: "p" });
  });

  it("citation markers like [1] stay as text", () => {
    expect(plainText("Builds cars [1].")).toBe("Builds cars [1].");
  });

  it("empty and non-string input is an empty message", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown(undefined as never)).toEqual([]);
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });
});

describe("links", () => {
  it("an https link is a link; its label can carry emphasis", () => {
    expect(inline("see [the **docs**](https://example.com/a?b=1)")).toEqual([
      { t: "text", v: "see " },
      { t: "link", href: "https://example.com/a?b=1", c: [{ t: "text", v: "the " }, { t: "bold", c: [{ t: "text", v: "docs" }] }] },
    ]);
  });

  it("every other scheme keeps only the label", () => {
    for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>x</script>", "http://plain.example/", "//evil.example/x", "/relative", "vbscript:x", "file:///etc/passwd", "ftp://x.example/", "mailto:a@b.c", "https://user:pw@evil.example/", "https://exa mple.com/", "https://x.example/\"onmouseover=\"x"]) {
      const out = inline(`[click me](${url})`);
      expect(out.some((n) => n.t === "link"), url).toBe(false);
      expect(text(out), url).toContain("click me");
    }
  });

  it("links are off for text that came from the web", () => {
    const out = inline("[site](https://tesla.example/de)", false);
    expect(out.some((n) => n.t === "link")).toBe(false);
    expect(text(out)).toBe("site");
  });

  it("safeHttpsUrl normalises and rejects", () => {
    expect(safeHttpsUrl(" https://Example.com/x ")).toBe("https://example.com/x");
    expect(safeHttpsUrl("https://")).toBeNull();
    expect(safeHttpsUrl("not a url")).toBeNull();
    expect(safeHttpsUrl("https://x.example/" + "a".repeat(3000))).toBeNull();
  });

  it("a bare URL in text is just text, never a link", () => {
    expect(inline("go to https://example.com now").some((n) => n.t === "link")).toBe(false);
  });
});

describe("hostile and very long input", () => {
  it("HTML is plain text in the tree: nothing is interpreted or removed here, escaping is the renderer's job", () => {
    const out = inline("<script>alert(1)</script> <b>x</b> <img src=x onerror=alert(1)>");
    expect(out).toEqual([{ t: "text", v: "<script>alert(1)</script> <b>x</b> <img src=x onerror=alert(1)>" }]);
  });

  it("deep nesting stops at a fixed depth instead of recursing without end", () => {
    const deep = "*".repeat(1) + "a **b *c **d *e **f** e* d** c* b** a*";
    expect(() => parseInlineText(deep)).not.toThrow();
    const many = "[".repeat(5000) + "x" + "](https://a.example/)".repeat(1);
    expect(() => parseInlineText(many)).not.toThrow();
  });

  it("20,000 unclosed markers parse in well under a second", () => {
    for (const unit of ["*a ", "**a ", "_a ", "`a ", "[a](", "[a ", "~~a "]) {
      const t0 = Date.now();
      parseMarkdown(unit.repeat(Math.floor(MAX_MD_CHARS / unit.length)));
      expect(Date.now() - t0, unit).toBeLessThan(1500);
    }
  });

  it("text beyond the cap is cut, not parsed", () => {
    const long = "x".repeat(MAX_MD_CHARS + 5000);
    const b = parseMarkdown(long);
    expect(text((b[0] as Extract<Block, { t: "p" }>).lines[0])).toHaveLength(MAX_MD_CHARS);
  });

  it("a single line of 20,000 list items-looking characters does not explode", () => {
    expect(() => parseMarkdown("- ".repeat(10_000))).not.toThrow();
    expect(() => parseMarkdown("1. ".repeat(6_000))).not.toThrow();
  });
});
