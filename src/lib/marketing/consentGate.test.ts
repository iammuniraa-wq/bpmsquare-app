import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTINGS_MENU } from "@/lib/settingsMenu";

const read = (...p: string[]) => readFileSync(join(__dirname, "..", "..", ...p), "utf8");

// Consent lives in one place and every workspace that sends marketing email can open it
// (docs/design/marketing-two-parts.md, slice 4). Scoring and hand-over still need the scoring program.
describe("the Consent page opens for any marketing workspace", () => {
  it("the menu entry accepts Marketing, scoring or the studio", () => {
    const e = SETTINGS_MENU.find((m) => m.id === "marketing-consent")!;
    expect(e.featureAnyOf).toContain("marketing");
  });

  it("the page and the two Consent routes accept the same flags", () => {
    expect(read("app", "(app)", "settings", "marketing-consent", "page.tsx")).toContain("f?.marketing !== true");
    expect(read("app", "api", "settings", "marketing-consent", "route.ts")).toContain("loadMarketingSettingsContext({ consent: true })");
    expect(read("app", "api", "settings", "marketing-limits", "route.ts")).toContain("loadMarketingSettingsContext({ consent: true })");
  });

  it("scoring and hand-over still need the scoring program", () => {
    expect(read("app", "api", "settings", "marketing-scoring", "route.ts")).not.toContain("consent: true");
    expect(read("app", "api", "settings", "marketing-handover", "route.ts")).not.toContain("consent: true");
  });

  it("a message screen shows the consent chip, not a topic definition", () => {
    expect(read("components", "marketing", "NewsletterSourceCard.tsx")).toContain("ConsentChip");
    expect(read("components", "marketing", "NewsletterSourceCard.tsx")).not.toContain("Any consent topic");
    expect(read("components", "marketing", "ConsentChip.tsx")).toContain("ROUTES.settingsMarketingConsent");
  });
});
