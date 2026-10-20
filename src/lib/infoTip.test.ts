import { describe, expect, it } from "vitest";
import { GUIDE_LINKS } from "./guideLinks";
import { guideHref, isSheetMode, placePopover, tipButtonAria, tipTextProblems, TIP_MAX_CHARS, type Box } from "./infoTip";

const box = (left: number, top: number, w = 16, h = 16): Box => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });

describe("tipTextProblems", () => {
  it("accepts one or two short sentences", () => {
    expect(tipTextProblems("Only people who agreed to hear about this topic receive it.")).toEqual([]);
    expect(tipTextProblems("Fires when a quote is sent. The contact on the quote enters.")).toEqual([]);
  });
  it("rejects empty text, three sentences, a long text and a list", () => {
    expect(tipTextProblems("  ")).toContain("empty");
    expect(tipTextProblems("One. Two. Three.")).toEqual([expect.stringContaining("more than 2 sentences")]);
    expect(tipTextProblems("x".repeat(TIP_MAX_CHARS + 1))[0]).toContain("longer than 160");
    expect(tipTextProblems("- one\n- two")).toContain("contains a list or line break");
  });
  it("does not count a decimal or a placeholder as a sentence end", () => {
    expect(tipTextProblems("Wait 2.5 days. {{account_name}} is replaced for each person.")).toEqual([]);
  });
});

describe("isSheetMode", () => {
  it("is a sheet under 900 px or on a touch screen, a popover otherwise", () => {
    expect(isSheetMode(899, false)).toBe(true);
    expect(isSheetMode(375, false)).toBe(true);
    expect(isSheetMode(1280, true)).toBe(true);
    expect(isSheetMode(900, false)).toBe(false);
  });
});

describe("tipButtonAria", () => {
  it("names the control and describes it by the tooltip only while open", () => {
    expect(tipButtonAria("Topic", false, "p1", false)).toEqual({ "aria-label": "About Topic", "aria-expanded": false, "aria-controls": "p1", "aria-describedby": undefined });
    expect(tipButtonAria("Topic", true, "p1", false)["aria-describedby"]).toBe("p1");
  });
  it("does not use aria-describedby for the sheet, which is a dialog", () => {
    expect(tipButtonAria("Topic", true, "p1", true)["aria-describedby"]).toBeUndefined();
  });
});

describe("placePopover", () => {
  const vp = { width: 1280, height: 800 };
  const pop = { width: 280, height: 90 };
  it("opens centred below the icon", () => {
    const r = placePopover(box(400, 100), pop, vp);
    expect(r.above).toBe(false);
    expect(r.top).toBe(100 + 16 + 8);
    expect(r.left).toBe(400 + 8 - 140);
  });
  it("flips above when there is no room below", () => {
    const r = placePopover(box(400, 740), pop, vp);
    expect(r.above).toBe(true);
    expect(r.top).toBe(740 - 8 - 90);
  });
  it("stays 8 px inside the left and right edges", () => {
    expect(placePopover(box(2, 100), pop, vp).left).toBe(8);
    expect(placePopover(box(1270, 100), pop, vp).left).toBe(1280 - 8 - 280);
  });
  it("prefers above when asked and it fits", () => {
    expect(placePopover(box(400, 300), pop, vp, "above").above).toBe(true);
  });
});

describe("guideHref", () => {
  it("draws no link until the guide address is set, or for an unknown key", () => {
    expect(guideHref(GUIDE_LINKS, "journeys", undefined)).toBeNull();
    expect(guideHref(GUIDE_LINKS, "nope", "https://guide.example")).toBeNull();
    expect(guideHref(GUIDE_LINKS, undefined, "https://guide.example")).toBeNull();
  });
  it("joins the base and the section anchor", () => {
    expect(guideHref(GUIDE_LINKS, "journeys", "https://guide.example/")).toBe("https://guide.example#6-journeys");
  });
  it("every GUIDE_LINKS anchor is a section of the how-to guide", () => {
    for (const [k, v] of Object.entries(GUIDE_LINKS)) expect(v, k).toMatch(/^#[1-9]\d?-[a-z-]+$/);
  });
});
