import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { SETTINGS_TIPS } from "./settingsTips";

describe("the general Settings explanations behind the i", () => {
  it("every one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(SETTINGS_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
});

describe("batch S1 stays subtracted", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("the Developer page carries no hand-typed endpoint, coming-soon or integrations lists", () => {
    const src = read("src/app/(app)/settings/developer/page.tsx");
    for (const gone of ["API_ENDPOINTS", "API_COMING_SOON", "INTEGRATIONS", "/api/v1/accounts"]) expect(src, gone).not.toContain(gone);
  });
  it("the field kit shows the shared i to every workspace", () => {
    const src = read("src/components/settings/SettingsField.tsx");
    expect(src).not.toContain("LegacyHelpDot");
    expect(src).not.toContain("useInfoTip");
  });
});
