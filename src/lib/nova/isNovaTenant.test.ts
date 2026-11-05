import { describe, expect, it } from "vitest";
import { isNovaTenant, isRichTenant } from "./isNovaTenant";

type T = Parameters<typeof isRichTenant>[0];
const t = (ui_theme: string | undefined, next_experience: boolean | undefined, rich_ui: boolean | undefined): T =>
  ({ config: { appearance: { ui_theme, rich_ui } }, features: { next_experience } }) as T;

describe("the Rich gate", () => {
  it("needs Nova (theme + platform flag) AND the workspace switch", () => {
    expect(isRichTenant(t("nextgen2", true, true))).toBe(true);
  });

  it("is off when any one of the three is missing", () => {
    expect(isRichTenant(t("nextgen2", true, false))).toBe(false);
    expect(isRichTenant(t("nextgen2", true, undefined))).toBe(false);
    expect(isRichTenant(t("nextgen2", false, true))).toBe(false);
    expect(isRichTenant(t("nextgen2", undefined, true))).toBe(false);
    expect(isRichTenant(t("nextgen", true, true))).toBe(false);
    expect(isRichTenant(t("classic", true, true))).toBe(false);
  });

  it("reads a missing tenant or config as off", () => {
    expect(isRichTenant(null)).toBe(false);
    expect(isRichTenant(undefined)).toBe(false);
    expect(isRichTenant({} as T)).toBe(false);
  });

  it("never turns on for a tenant Nova itself is off for", () => {
    for (const ui of ["nextgen2", "nextgen", "modern", "classic", undefined]) {
      for (const flag of [true, false, undefined]) {
        const tenant = t(ui, flag, true);
        if (isRichTenant(tenant)) expect(isNovaTenant(tenant as never)).toBe(true);
      }
    }
  });
});
