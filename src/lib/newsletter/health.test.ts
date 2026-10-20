import { describe, it, expect } from "vitest";
import { runChecks, brokenPlaceholders, shoutingWords, GMAIL_CLIP_BYTES, type Check } from "./checks";
import { resolveBrandKit } from "./brandKit";
import { BUILT_IN_DESIGNS, languageRowsOf } from "./designs";
import { sanitizeNewsletterBlocks } from "./sanitize";
import type { LanguageRow, NewsletterBlock } from "./types";

const T = "11111111-1111-4111-8111-111111111111";
const kit = resolveBrandKit({}, { name: "Al Noor" });
const monthly = BUILT_IN_DESIGNS.find((d) => d.id === "monthly-update")!;

function health(over: { blocks?: NewsletterBlock[]; mutate?: (rows: LanguageRow[]) => void } = {}): Record<string, Check> {
  const rows = languageRowsOf(monthly);
  rows[0].subject = "Your October update";
  rows[0].preheader = "Three things worth a minute";
  over.mutate?.(rows);
  const blocks = (over.blocks ?? monthly.blocks).map((b) => (b.id === "button1" ? { ...b, settings: { url: "https://example.com/a" } } : b));
  return Object.fromEntries(runChecks({ blocks, languages: rows, kit, tenantId: T }).map((c) => [c.id, c]));
}

describe("content health", () => {
  it("a tidy design is green on every rule it can judge", () => {
    const h = health();
    for (const id of ["footer", "subject-en", "preheader-en", "length", "https", "gmail", "spam", "caps", "placeholders", "contrast"]) expect(h[id]?.tone, id).toBe("good");
  });

  it("every amber item says in plain words what to change, and a green one does not nag", () => {
    const h = health({ mutate: (r) => { r[0].subject = ""; r[0].preheader = ""; r[0].texts.text1 = { text: "ACT NOW for a GUARANTEE, URGENT SALE {{ account_name }}" }; } });
    const warn = Object.values(h).filter((c) => c.tone === "warn");
    expect(warn.length).toBeGreaterThan(3);
    for (const c of warn) expect(c.fix, c.id).toBeTruthy();
    for (const c of Object.values(h).filter((x) => x.tone === "good")) expect(c.fix).toBeUndefined();
  });

  it("subject: too long, empty; preheader: missing", () => {
    expect(health({ mutate: (r) => { r[0].subject = "x".repeat(80); } })["subject-en"]).toMatchObject({ tone: "warn" });
    expect(health({ mutate: (r) => { r[0].subject = "x".repeat(80); } })["subject-en"].fix).toMatch(/60 characters/);
    expect(health({ mutate: (r) => { r[0].preheader = ""; } })["preheader-en"].tone).toBe("warn");
  });

  it("total length and link count", () => {
    expect(health({ mutate: (r) => { r[0].texts.text1 = { text: "word ".repeat(900) }; } }).length.tone).toBe("warn");
    const many = [
      ...monthly.blocks.slice(0, -1),
      ...Array.from({ length: 12 }, (_, i) => ({ id: `button${i + 10}`, type: "button" as const, visible: true, settings: { url: `https://example.com/${i}` } })),
      monthly.blocks[monthly.blocks.length - 1],
    ];
    const h = health({ blocks: many, mutate: (r) => { for (let i = 0; i < 12; i++) r[0].texts[`button${i + 10}`] = { label: "Go" }; } });
    expect(h.https.tone).toBe("warn");
    expect(h.https.label).toMatch(/links/);
    const none = monthly.blocks.filter((b) => !["button", "product", "interest"].includes(b.type));
    expect(health({ blocks: none }).https.label).toBe("No links to click");
  });

  it("images: missing description and heavy weight", () => {
    const img: NewsletterBlock = { id: "image1", type: "image", visible: true, settings: { path: `${T}/assets/a.png`, bytes: 900 * 1024 } };
    const blocks = [...monthly.blocks.slice(0, -1), img, monthly.blocks[monthly.blocks.length - 1]];
    const h = health({ blocks });
    expect(h.images.tone).toBe("warn");
    expect(h["image-weight"].tone).toBe("warn");
    expect(h["image-weight"].fix).toMatch(/500 KB/);
    const ok = health({ blocks: blocks.map((b) => (b.id === "image1" ? { ...b, settings: { ...b.settings, bytes: 80 * 1024 } } : b)), mutate: (r) => { r[0].texts.image1 = { alt: "Anchors on a shelf" }; r[0].texts.text1 = { text: "word ".repeat(60) }; } });
    expect(ok.images.tone).toBe("good");
    expect(ok["image-weight"].tone).toBe("good");
  });

  it("the upload size is kept as a number, and only for a picture of this tenant", () => {
    const { blocks } = sanitizeNewsletterBlocks([
      { id: "i", type: "image", settings: { path: `${T}/assets/a.png`, bytes: "123456" } },
      { id: "j", type: "image", settings: { path: "https://elsewhere/x.png", bytes: 5 } },
      { id: "k", type: "image", settings: { path: `${T}/assets/b.png`, bytes: -1 } },
    ], T);
    expect(blocks.find((b) => b.id === "i")!.settings).toEqual({ path: `${T}/assets/a.png`, bytes: 123456 });
    expect(blocks.find((b) => b.id === "j")!.settings).toEqual({});
    expect(blocks.find((b) => b.id === "k")!.settings).toEqual({ path: `${T}/assets/b.png` });
  });

  it("the unsubscribe and preferences links must be in every language's email", () => {
    const noFooter = monthly.blocks.map((b) => (b.type === "footer" ? { ...b, visible: false } : b));
    expect(health({ blocks: noFooter }).footer.tone).toBe("warn");
  });

  it("ALL CAPS and spam-trigger words", () => {
    expect(shoutingWords("BUY THESE ANCHORS NOW, QAR 40 and ISO tested")).toEqual(["BUY", "THESE", "ANCHORS"].filter((w) => w.length >= 4));
    const h = health({ mutate: (r) => { r[0].texts.text1 = { text: "AMAZING WONDERFUL FANTASTIC offer, act now" }; } });
    expect(h.caps.tone).toBe("warn");
    expect(h.spam.tone).toBe("warn");
    expect(health({ mutate: (r) => { r[0].subject = "SPECIAL OFFER INSIDE"; } }).caps.label).toBe("The subject is all capitals");
  });

  it("a Gmail clipping warning near and over 102 KB", () => {
    const filler = "x".repeat(30_000);
    const many = health({ mutate: (r) => { r[0].texts.text1 = { text: filler }; r[0].texts.hero1 = { title: "T", text: filler }; r[0].texts.columns1 = { t1: "a", p1: filler.slice(0, 1200), t2: "b", p2: "c" }; } });
    // sanitising caps a field at 4000 characters, so build the oversize case from many blocks instead
    const text = (i: number): NewsletterBlock => ({ id: `text${i + 10}`, type: "text", visible: true, settings: {} });
    const blocks = [...monthly.blocks.slice(0, -1), ...Array.from({ length: 40 }, (_, i) => text(i)), monthly.blocks[monthly.blocks.length - 1]];
    const big = health({ blocks, mutate: (r) => { for (let i = 0; i < 40; i++) r[0].texts[`text${i + 10}`] = { text: "lorem ipsum ".repeat(300) }; } });
    expect(big["gmail-en"] ?? big.gmail).toBeTruthy();
    expect(Object.values(big).some((c) => c.id.startsWith("gmail") && c.tone === "warn")).toBe(true);
    expect(Object.values(big).find((c) => c.id.startsWith("gmail"))!.fix).toMatch(/Remove a block/);
    expect(many.gmail?.tone ?? "good").toBe("good");
    expect(GMAIL_CLIP_BYTES).toBe(102_000);
  });

  it("broken placeholders: spaces, single braces, two words, a missing brace", () => {
    expect(brokenPlaceholders("Hi {{account_name}}, {{ company_name }} {contact_name} {{two words}}")).toEqual(["{{ company_name }}", "{{two words}}", "{contact_name}"]);
    expect(brokenPlaceholders("Hi {{account_name}} and {{company_name")).toEqual(["an unmatched { or }"]);
    expect(brokenPlaceholders("Hi {{account_name}}")).toEqual([]);
    const h = health({ mutate: (r) => { r[0].texts.text1 = { text: "Dear {{ account_name }}" }; } });
    expect(h.placeholders.tone).toBe("warn");
    expect(h.placeholders.fix).toMatch(/no spaces/);
  });
});
