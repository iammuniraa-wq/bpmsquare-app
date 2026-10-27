import { describe, expect, it } from "vitest";
import { isTenderDeskStyle, resolveTenderDeskStyle, TENDER_DESK_COOKIE, TENDER_DESK_STYLES } from "./style";

const ANY = [undefined, null, "", "bold", "control", "classic", "nonsense"];

describe("tender desk style", () => {
  it("names the cookie and the two values", () => {
    expect(TENDER_DESK_COOKIE).toBe("bpm_tender_desk");
    expect([...TENDER_DESK_STYLES]).toEqual(["bold", "control"]);
  });

  it("is null (no desk: the caller renders the home the workspace always had) whenever the tender edition is off", () => {
    for (const cookie of ANY) for (const tenantDefault of ANY) expect(resolveTenderDeskStyle({ cookie, tenantDefault, flagOn: false })).toBeNull();
  });

  it("uses the cookie first, when it is one of the two values", () => {
    for (const cookie of TENDER_DESK_STYLES) {
      for (const tenantDefault of ANY) expect(resolveTenderDeskStyle({ cookie, tenantDefault, flagOn: true })).toBe(cookie);
    }
  });

  it("falls to the workspace default when the cookie is missing or not allowed", () => {
    for (const cookie of [undefined, null, "", "Bold", "BOLD", " bold", "dark", "classic", "<script>"]) {
      expect(resolveTenderDeskStyle({ cookie, tenantDefault: "control", flagOn: true })).toBe("control");
      expect(resolveTenderDeskStyle({ cookie, tenantDefault: "bold", flagOn: true })).toBe("bold");
    }
  });

  it("falls to bold when neither the cookie nor the default is usable", () => {
    for (const cookie of [undefined, null, "", "x", "classic"]) {
      for (const tenantDefault of [undefined, null, "", "x", "Control", "classic"]) {
        expect(resolveTenderDeskStyle({ cookie, tenantDefault, flagOn: true })).toBe("bold");
      }
    }
  });

  it("recognises exactly the two values", () => {
    expect(TENDER_DESK_STYLES.every(isTenderDeskStyle)).toBe(true);
    for (const v of [undefined, null, 1, {}, "", "Bold", "bold ", "classic", "modern"]) expect(isTenderDeskStyle(v)).toBe(false);
  });
});
