import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import NewsletterStudio, { type StudioProps } from "./NewsletterStudio";
import { BUILT_IN_DESIGNS, languageRowsOf } from "@/lib/newsletter/designs";

// A render smoke test: the screen must produce its markup from real props without throwing, with every
// option group carrying its one-line hint and the structure the mock-up describes.

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
  it("renders the six option groups, each with a button, a summary and a plain-words hint", () => {
    const out = html(props());
    for (const title of ["Start", "Blocks", "Languages", "Content health", "Brand kit", "Use it"]) expect(out).toContain(`<b>${title}</b>`);
    expect(out.match(/aria-expanded=/g)!.length).toBeGreaterThanOrEqual(6);
    expect(out).toContain("How to begin: say what this issue is about, pick a design, or start blank.");
    expect(out).toContain("English is written first. Add a language on top and each person gets their own.");
    expect(out).toContain("Rules that run every time, never opinions or a score. Each amber item says what to change.");
    expect(out).toContain("Your logo, colours and fonts, set once by an admin and used by every design.");
    expect(out).toContain("Keep this design, or hand it to a campaign.");
  });

  it("shows the language tabs with the Arabic name, the device and appearance switches and Show me how", () => {
    const out = html(props());
    expect(out).toContain("English");
    expect(out).toContain("العربية");
    expect(out).toContain("+ Add language");
    for (const t of ["Desktop", "Phone", "Light", "Dark", "Show me how"]) expect(out).toContain(t);
    expect(out).toContain("Use in a campaign");
    expect(out).toContain("Save as template");
  });

  it("flags the Arabic lines that still need a person (the badge on the tab)", () => {
    const out = html(props());
    expect(out).toMatch(/<span class="[^"]*">4<\/span>|>4</);
  });

  it("a template cannot be used in a campaign", () => {
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
