import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import NewsletterStudio, { type StudioProps } from "./NewsletterStudio";
import { BUILT_IN_DESIGNS, languageRowsOf } from "@/lib/newsletter/designs";
import { NEWSLETTER_TIPS } from "@/lib/newsletter/tips";
import { tipTextProblems } from "@/lib/infoTip";

// A render smoke test: the screen must produce its markup from real props without throwing, with the four option
// groups each carrying an "i" (their explanations are not printed), and Save / Send... in the header.

const eid = BUILT_IN_DESIGNS.find((d) => d.id === "festival-eid")!;
const props = (over: Partial<StudioProps["initial"]> = {}, extra: Partial<StudioProps> = {}): StudioProps => ({
  initial: {
    id: "n1", ref: "NWS-0001", name: "Eid", category: "Festival", topic: null, status: "draft", isTemplate: false,
    blocks: eid.blocks, languages: languageRowsOf(eid), versions: [], templateOriginId: null, builtInOrigin: null, createdAt: "2026-10-19T10:00:00Z", ...over,
  },
  topics: [{ key: "offers", label: "Offers" }], templates: [{ id: "t1", name: "Monthly", category: "Newsletter" }],
  kit: { companyName: "Al Noor", primary: "#16365c", secondary: "#c8892a", fontLabel: "Arial", footerAddress: "Doha", hasLogo: false },
  canEdit: true, isAdmin: true, aiReady: true, footerAddress: "Doha", ...extra,
});

const html = (p: StudioProps) => renderToString(createElement(NewsletterStudio, p));

describe("the studio screen", () => {
  it("renders four option groups, each a row with its own button and an i, and prints none of their explanations", () => {
    const out = html(props());
    for (const title of ["Start", "Blocks", "Languages", "Health"]) {
      expect(out).toMatch(new RegExp(`class="bpm-og-title"[^>]*>${title}</button><button[^>]*aria-label="About ${title}"`));
    }
    for (const gone of ["Brand kit", "Use it", "Content health"]) expect(out).not.toContain(`>${gone}<`);
    expect(out.match(/class="bpm-og(?: [a-z]+)*"/g)!.length).toBe(4);
    for (const text of [NEWSLETTER_TIPS.start, NEWSLETTER_TIPS.blocks, NEWSLETTER_TIPS.languages, NEWSLETTER_TIPS.health, NEWSLETTER_TIPS.consentTopic]) expect(out).not.toContain(text);
  });

  it("puts the panel groups on a kit tab strip for the phone", () => {
    const out = html(props());
    expect(out).toMatch(/role="tablist" aria-label="Options"/);
    for (const t of ["Start", "Blocks", "Languages", "Health"]) expect(out).toMatch(new RegExp(`role="tab"[^>]*class="bpm-tab"[^>]*>${t}`));
  });

  it("has the i on the labels that carry an explanation", () => {
    const out = html(props());
    for (const l of ["Name", "Consent topic", "Brand", "Preview", "Preheader"]) expect(out).toContain(`aria-label="About ${l}"`);
    expect(out).toContain(">Any consent topic<");
  });

  it("shows the language tabs with the Arabic name, the device and appearance switches and Show me how", () => {
    const out = html(props());
    expect(out).toContain("English");
    expect(out).toContain("العربية");
    expect(out).toContain("+ Add language");
    for (const t of ["Desktop", "Phone", "Light", "Dark", "Show me how"]) expect(out).toContain(t);
  });

  it("puts Save and Send... in the header and the phone's bottom bar, with Save as template behind the more menu", () => {
    const out = html(props());
    expect(out).toContain("Send...");
    expect(out.match(/Send\.\.\./g)!.length).toBe(2);
    expect(out).not.toContain("Use in a campaign");
    expect(out).toContain('aria-label="More actions"');
    expect(out).not.toContain("Save as template");
  });

  it("flags the Arabic lines that still need a person (the badge on the tab)", () => {
    const out = html(props());
    expect(out).toMatch(/<span class="[^"]*">4<\/span>|>4</);
  });

  it("a template cannot be sent", () => {
    expect(html(props({ isTemplate: true }))).not.toContain('id="nlCampaignBtn"');
    expect(html(props())).toContain('id="nlCampaignBtn"');
  });

  it("a person who cannot edit sees it read-only, with the reason", () => {
    const out = html(props({}, { canEdit: false }));
    expect(out).toContain("You can look at this newsletter but not change it.");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>[^<]*Save/);
  });

  it("a new, unsaved newsletter opens on Start and says AI is unavailable when it is not set up", () => {
    const out = html(props({ id: null, ref: null, name: "", blocks: eid.blocks.filter((b) => b.type === "header" || b.type === "footer") }, { aiReady: false }));
    expect(out).toContain("New newsletter");
    expect(out).toContain("AI is not set up for this workspace.");
  });
});

describe("the explanations behind the i", () => {
  it("every one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(NEWSLETTER_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});
