import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { compareLanguages } from "./compare";
import { BUILT_IN_DESIGNS, languageRowsOf } from "./designs";
import LanguageCompare from "@/app/(app)/marketing/newsletters/LanguageCompare";

const eid = BUILT_IN_DESIGNS.find((d) => d.id === "festival-eid")!;
const [en, ar] = languageRowsOf(eid);

describe("language compare", () => {
  it("lines up each visible block's words in both languages with the review state of each", () => {
    const c = compareLanguages(eid.blocks, en, ar);
    expect(c.rows.map((r) => r.type)).toEqual(["header", "hero", "text", "footer"]);
    const hero = c.rows.find((r) => r.type === "hero")!;
    expect(hero.fields[0]).toMatchObject({ field: "title", a: "Eid Mubarak", b: "عيد مبارك" });
    expect(hero.a).toBe("written");
    expect(hero.b).toBe("translated");
    expect(c.pendingB).toBe(4);
    expect(c.subject.b).toContain("عيد مبارك");
  });

  it("leaves out hidden blocks and counts only what is still waiting", () => {
    const blocks = eid.blocks.map((b) => (b.id === "text1" ? { ...b, visible: false } : b));
    const reviewed = { ...ar, review: { ...ar.review, hero1: "reviewed" as const } };
    const c = compareLanguages(blocks, en, reviewed);
    expect(c.rows.map((r) => r.blockId)).not.toContain("text1");
    expect(c.pendingB).toBe(2);
    expect(c.rows.find((r) => r.blockId === "hero1")!.b).toBe("reviewed");
  });

  it("the screen shows both languages side by side, each in its own direction, with Check this and Accept", () => {
    const out = renderToString(createElement(LanguageCompare, {
      blocks: eid.blocks, languages: [en, ar], left: "en", right: "ar", onPick: () => {}, canEdit: true, onAccept: () => {}, onEdit: () => {},
    }));
    expect(out).toContain("Eid Mubarak");
    expect(out).toContain("عيد مبارك");
    expect(out).toContain('dir="rtl"');
    expect(out).toContain("Check this");
    expect(out).toContain("Accept Arabic");
    expect(out).toContain("4 blocks in Arabic still need a check.");
    const readOnly = renderToString(createElement(LanguageCompare, {
      blocks: eid.blocks, languages: [en, ar], left: "en", right: "ar", onPick: () => {}, canEdit: false, onAccept: () => {}, onEdit: () => {},
    }));
    expect(readOnly).not.toContain("Accept Arabic");
  });
});
