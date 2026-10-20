import { describe, it, expect } from "vitest";
import { renderNewsletter } from "./render";
import { resolveBrandKit } from "./brandKit";
import { sanitizeNewsletterBlocks, sanitizeTexts, safeUrl, cleanText } from "./sanitize";
import { fillTokens } from "./tokens";
import { BUILT_IN_DESIGNS, builtInDesign } from "./designs";
import type { NewsletterBlock, TextMap } from "./types";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BASE = "https://x.supabase.co/storage/v1/object/public/company-assets";
const kit = resolveBrandKit({ social_links: [{ label: "LinkedIn", url: "https://linkedin.com/company/x" }] }, { name: "Al Noor", logo_url: null });

const ALL_TYPES: NewsletterBlock[] = [
  { id: "header1", type: "header", visible: true, locked: true, settings: {} },
  { id: "hero1", type: "hero", visible: true, settings: {} },
  { id: "text1", type: "text", visible: true, settings: {} },
  { id: "image1", type: "image", visible: true, settings: { path: `${TENANT}/assets/a.png`, link: "https://example.com/a" } },
  { id: "button1", type: "button", visible: true, settings: { url: "https://example.com/b" } },
  { id: "columns1", type: "columns", visible: true, settings: {} },
  { id: "product1", type: "product", visible: true, settings: { path: `${TENANT}/assets/p.png`, url: "https://example.com/p", product_id: "33333333-3333-4333-8333-333333333333" } },
  { id: "event1", type: "event", visible: true, settings: { url: "https://example.com/e" } },
  { id: "divider1", type: "divider", visible: true, settings: {} },
  { id: "social1", type: "social", visible: true, settings: {} },
  { id: "interest1", type: "interest", visible: true, settings: {} },
  { id: "footer1", type: "footer", visible: true, locked: true, settings: {} },
];

const TEXTS: TextMap = {
  header1: { tag: "October" },
  hero1: { title: "Hello", text: "Intro" },
  text1: { text: "Dear {{account_name}},\nBody line" },
  image1: { alt: "A picture" },
  button1: { label: "Go" },
  columns1: { t1: "One", p1: "first", t2: "Two", p2: "second" },
  product1: { name: "Anchor", text: "Strong", price: "QAR 14.50", from: "Catalogue" },
  event1: { title: "Open day", text: "Come", when: "Saturday", where: "Doha" },
  interest1: { label: "Interested?" },
  footer1: { text: "Industrial Area", unsub: "Unsubscribe", prefs: "Manage preferences" },
};

const render = (over: Partial<Parameters<typeof renderNewsletter>[0]> = {}) =>
  renderNewsletter({
    blocks: ALL_TYPES, tenantId: TENANT, assetBase: BASE, kit, target: "version",
    language: { lang: "en", dir: "ltr", subject: "S", preheader: "P", texts: TEXTS }, ...over,
  });

describe("renderNewsletter", () => {
  it("renders all twelve block types in tables with inline styles, no scripts", () => {
    const { html } = render();
    for (const needle of ["October", "Hello", "Body line", "A picture", "Go", "first", "Anchor", "Open day", "LinkedIn", "Interested?", "Industrial Area"]) {
      expect(html).toContain(needle);
    }
    expect(html).toContain('role="presentation"');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<div[^>]*class="(?!nl-)/);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  });

  it("keeps tokens for the send in a version and fills them in a preview", () => {
    const v = render();
    expect(v.html).toContain("{{account_name}}");
    expect(v.html).toContain("{{unsubscribe_url}}");
    expect(v.html).toContain("{{preferences_url}}");
    expect(v.html).toContain("{{interest_url}}");
    expect(v.html).toMatch(/href="\{\{click_0\}\}"/);
    const p = render({ target: "preview" });
    expect(p.html).not.toContain("{{");
    expect(p.html).toContain("Qatar Steel Fabrication WLL");
    expect(p.html).toContain('href="https://example.com/b"');
  });

  it("lists every tracked link in order, with the product id and never the unsubscribe or interest links", () => {
    const { links } = render();
    expect(links.map((l) => l.block_type)).toEqual(["image", "button", "product", "event", "social"]);
    expect(links[2].product_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(links.every((l) => l.url.startsWith("https://"))).toBe(true);
  });

  it("escapes every text, whatever the stored string contains", () => {
    const evil: TextMap = { ...TEXTS, hero1: { title: '<img src=x onerror=alert(1)>"', text: "<script>alert(1)</script>" }, footer1: { text: "<b>x</b>", unsub: '"><a>', prefs: "p" } };
    const { html, text } = render({ language: { lang: "en", dir: "ltr", subject: "<i>s</i>", preheader: "<u>p</u>", texts: evil } });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>s</i>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(text).toContain("<script>"); // the plain-text part is plain text, not markup
  });

  it("refuses a javascript: or data: link and an external or cross-tenant image", () => {
    const blocks: NewsletterBlock[] = ALL_TYPES.map((b) => b.id === "button1" ? { ...b, settings: { url: "javascript:alert(1)" } } : b.id === "image1" ? { ...b, settings: { path: `${OTHER}/assets/a.png`, link: "data:text/html,x" } } : b.id === "product1" ? { ...b, settings: { path: "https://evil.example/x.png", url: "https://example.com/p" } } : b);
    const { html, links } = render({ blocks });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain(OTHER);
    expect(links.map((l) => l.block_type)).not.toContain("button");
    expect(links.map((l) => l.block_type)).not.toContain("image");
  });

  it("ignores a hostile colour and an unknown block type", () => {
    const blocks = [...ALL_TYPES.slice(0, 2), { id: "x1", type: "script" as never, visible: true, settings: {} }, ...ALL_TYPES.slice(2)]
      .map((b) => b.id === "hero1" ? { ...b, settings: { background: "red;background:url(javascript:x)" } } : b);
    const { html } = render({ blocks });
    expect(html).not.toContain("url(javascript");
    expect(html).not.toContain("red;");
  });

  describe("right-to-left", () => {
    const ar: TextMap = { ...TEXTS, header1: { tag: "أكتوبر" }, hero1: { title: "أهلاً", text: "مقدمة" }, columns1: { t1: "الأول", p1: "أ", t2: "الثاني", p2: "ب" }, button1: { label: "اذهب" }, footer1: { text: "المنطقة 24", unsub: "إلغاء", prefs: "تفضيلات" } };
    const rtl = () => render({ language: { lang: "ar", dir: "rtl", subject: "س", preheader: "", texts: ar } });

    it("sets dir on the root and on every cell that holds text", () => {
      const { html } = rtl();
      expect(html).toContain('<html lang="ar" dir="rtl"');
      const textCells = html.match(/<td[^>]*>/g)!.filter((t) => /text-align/.test(t));
      expect(textCells.length).toBeGreaterThan(8);
      for (const td of textCells) expect(td, td).toMatch(/dir="(rtl|ltr)"/);
      expect(html).toContain('text-align:right');
      expect(html).toMatch(/font-family:Tahoma/);
    });

    it("mirrors a two-column row in the markup itself", () => {
      const ltr = render().html;
      const flipped = rtl().html;
      const order = (h: string) => [h.indexOf(">One<") > -1 ? h.indexOf(">One<") : h.indexOf("الأول"), h.indexOf(">Two<") > -1 ? h.indexOf(">Two<") : h.indexOf("الثاني")];
      const [a1, a2] = order(ltr);
      const [b1, b2] = order(flipped);
      expect(a1).toBeLessThan(a2);
      expect(b2).toBeLessThan(b1);
    });

    it("keeps numbers and prices left-to-right", () => {
      const { html } = render({ language: { lang: "ar", dir: "rtl", subject: "س", preheader: "", texts: { ...ar, text1: { text: "اتصل على +974 4400 0000 قبل 31" } } } });
      expect(html).toContain('<span dir="ltr" style="unicode-bidi:isolate">+974 4400 0000</span>');
      expect(html).toContain('dir="ltr" style="font-weight:bold;');
    });
  });

  it("adds the open pixel only when asked", () => {
    expect(render().html).not.toContain("open_pixel_url");
    expect(render({ openPixel: true }).html).toContain("{{open_pixel_url}}");
  });

  it("renders every built-in design without leaving a token a recipient could see", () => {
    for (const d of BUILT_IN_DESIGNS) {
      for (const l of d.languages) {
        const out = renderNewsletter({
          blocks: d.blocks, tenantId: TENANT, assetBase: BASE, kit, target: "preview",
          language: { lang: l.lang, dir: l.lang === "ar" ? "rtl" : "ltr", subject: l.subject, preheader: l.preheader, texts: l.texts },
        });
        expect(out.html, `${d.id}/${l.lang}`).not.toContain("{{");
      }
    }
    expect(builtInDesign("festival-eid")?.languages.map((l) => l.lang)).toEqual(["en", "ar"]);
  });
});

describe("the sanitiser gate", () => {
  it("forces a header first and a footer last, drops unknown types, keeps ids unique", () => {
    const { blocks, notes } = sanitizeNewsletterBlocks([
      { id: "a", type: "text", visible: true }, { id: "a", type: "button", visible: false }, { type: "iframe" }, { type: "footer", visible: false },
    ], TENANT);
    expect(blocks[0].type).toBe("header");
    expect(blocks[blocks.length - 1].type).toBe("footer");
    expect(blocks[blocks.length - 1].visible).toBe(true);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
    expect(notes.join(" ")).toMatch(/unknown type/);
  });

  it("only keeps a tenant's own asset path and safe urls in settings", () => {
    const { blocks } = sanitizeNewsletterBlocks([
      { id: "i", type: "image", settings: { path: `${OTHER}/assets/a.png`, link: "https://ok.example/x" } },
      { id: "j", type: "image", settings: { path: `${TENANT}/assets/../../etc`, link: "javascript:1" } },
      { id: "k", type: "button", settings: { url: "https://ok.example/?a={{unsubscribe_url}}" } },
    ], TENANT);
    expect(blocks.find((b) => b.id === "i")!.settings).toEqual({ link: "https://ok.example/x" });
    expect(blocks.find((b) => b.id === "j")!.settings).toEqual({});
    expect(blocks.find((b) => b.id === "k")!.settings).toEqual({});
  });

  it("stores words as plain text: tag-like strings and control characters go, only defined fields stay", () => {
    const { blocks } = sanitizeNewsletterBlocks([{ id: "t", type: "text" }], TENANT);
    const t = sanitizeTexts({ t: { text: "Hello <b>there</b> a < b\u0000", evil: "x" }, nope: { text: "y" } }, blocks);
    expect(t).toEqual({ t: { text: "Hello there a < b" } });
    expect(cleanText("<script>alert(1)</script>ok", 100)).toBe("alert(1)ok");
  });

  it("safeUrl allows https, http, mailto and tel only", () => {
    expect(safeUrl("https://a.example/x?y=1")).toBeTruthy();
    expect(safeUrl("mailto:a@b.example")).toBeTruthy();
    expect(safeUrl("tel:+97444000000")).toBeTruthy();
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.example", "//x.example", "https://", "https://a b.example", "https://a.example/{{x}}"]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });
});

describe("fillTokens", () => {
  it("escapes values for html, removes unknown tokens and never expands a value twice", () => {
    expect(fillTokens("Hi {{n}} {{zzz}}", { n: "<b>A</b>" }, { html: true })).toBe("Hi &lt;b&gt;A&lt;/b&gt; ");
    expect(fillTokens("{{a}}", { a: "{{b}}", b: "boom" }, { html: false })).toBe("{{b}}");
    expect(fillTokens("x {{n}}", { n: "A&B" }, { html: false })).toBe("x A&B");
  });
});
