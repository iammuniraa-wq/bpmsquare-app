import { describe, expect, it } from "vitest";
import { iconKeyFor, oneLine, sortForCards } from "./templateCard";
import { parseTemplateHeader } from "./requests";
import { CHAINLINK_FENCE_STARTER, PRECAST_VILLA_STARTER, STARTER_TEMPLATES } from "./starterTemplates";
import { validateTemplate } from "./template";

describe("template cards", () => {
  it("uses the icon on the template, then the one its geometry implies, then a general one", () => {
    expect(iconKeyFor({ icon: "tiles", geometry: "chainlink_fence" })).toBe("tiles");
    expect(iconKeyFor({ icon: null, geometry: "chainlink_fence" })).toBe("fence");
    expect(iconKeyFor({ icon: null, geometry: "precast_villa" })).toBe("building");
    expect(iconKeyFor({ icon: "nonsense", geometry: null })).toBe("grid");
    expect(iconKeyFor({ geometry: null })).toBe("grid");
  });

  it("shows the first sentence, trimmed to a line", () => {
    expect(oneLine("Chain-link fence. More detail follows.")).toBe("Chain-link fence.");
    expect(oneLine(null)).toBe("");
    expect(oneLine("  ")).toBe("");
    const long = oneLine(`A very long sentence ${"with many words ".repeat(20)}that goes on.`, 80);
    expect(long.length).toBeLessThanOrEqual(81);
    expect(long.endsWith("…")).toBe(true);
    expect(oneLine("No full stop here")).toBe("No full stop here");
  });

  it("sorts by name without case or accents getting in the way", () => {
    expect(sortForCards([{ name: "zebra" }, { name: "Apple" }, { name: "banana" }]).map((x) => x.name)).toEqual(["Apple", "banana", "zebra"]);
  });
});

describe("template header fields", () => {
  it("accepts keywords (trimmed, lowercased, de-duplicated), an icon and customer visibility", () => {
    const r = parseTemplateHeader({ keywords: [" Fence ", "fence", "Gate", ""], icon: "fence", customer_visible: true }, { requireName: false });
    expect(r).toEqual({ ok: true, header: { keywords: ["fence", "gate"], icon: "fence", customer_visible: true } });
    expect(parseTemplateHeader({ keywords: [], icon: "" }, { requireName: false })).toEqual({ ok: true, header: { keywords: null, icon: null } });
  });
  it("refuses a bad icon, bad keywords and a non-boolean", () => {
    expect(parseTemplateHeader({ icon: "unicorn" }, { requireName: false }).ok).toBe(false);
    expect(parseTemplateHeader({ keywords: "fence" }, { requireName: false }).ok).toBe(false);
    expect(parseTemplateHeader({ keywords: [1] }, { requireName: false }).ok).toBe(false);
    expect(parseTemplateHeader({ customer_visible: "yes" }, { requireName: false }).ok).toBe(false);
  });
});

describe("starter templates", () => {
  it("all validate and carry a card line, an icon and words for the AI", () => {
    for (const s of STARTER_TEMPLATES) {
      const v = validateTemplate({ geometry: s.geometry, inputs: s.inputs, rates: s.rates, rules: s.rules });
      expect(v.ok, s.name).toBe(true);
      expect(oneLine(s.description).length, s.name).toBeGreaterThan(10);
      expect(s.icon, s.name).toBeTruthy();
      expect((s.keywords ?? []).length, s.name).toBeGreaterThan(3);
    }
  });
  it("only the fence starter is locked; the illustrative precast one stays editable", () => {
    expect(CHAINLINK_FENCE_STARTER.locked).toBe(true);
    expect(PRECAST_VILLA_STARTER.locked).toBeUndefined();
  });
  it("names are unique, so installing one is idempotent by name", () => {
    expect(new Set(STARTER_TEMPLATES.map((s) => s.name.toLowerCase())).size).toBe(STARTER_TEMPLATES.length);
  });
});
