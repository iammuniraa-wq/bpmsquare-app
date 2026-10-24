import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { MATERIALS, HEX_COLOUR, getMaterialDef, isVisualValue } from "./materialCatalog";

const TEXTURES = path.resolve(__dirname, "../../../public/textures");

describe("material catalogue and texture sets", () => {
  it("keys are unique and colours are valid", () => {
    expect(new Set(MATERIALS.map((m) => m.key)).size).toBe(MATERIALS.length);
    for (const m of MATERIALS) {
      expect(HEX_COLOUR.test(m.color), m.key).toBe(true);
      if (m.tint) expect(HEX_COLOUR.test(m.tint), m.key).toBe(true);
    }
  });

  it("every textured material has its texture files, a source id and a repeat size", () => {
    for (const m of MATERIALS.filter((x) => x.textured)) {
      const dir = path.join(TEXTURES, m.key);
      expect(existsSync(path.join(dir, "diffuse.jpg")), `${m.key} diffuse`).toBe(true);
      expect(existsSync(path.join(dir, "rough.jpg")), `${m.key} rough`).toBe(true);
      if (!m.no_normal) expect(existsSync(path.join(dir, "normal.jpg")), `${m.key} normal`).toBe(true);
      expect(m.source, m.key).toMatch(/^(polyhaven|ambientcg):\w+$/);
      expect(m.repeat_m ?? 0, m.key).toBeGreaterThan(0);
    }
  });

  it("every texture folder belongs to a textured material and is credited", () => {
    const credits = readFileSync(path.join(TEXTURES, "CREDITS.md"), "utf8");
    const folders = readdirSync(TEXTURES).filter((f) => statSync(path.join(TEXTURES, f)).isDirectory());
    for (const f of folders) expect(getMaterialDef(f)?.textured, f).toBe(true);
    for (const m of MATERIALS.filter((x) => x.textured)) {
      expect(credits, m.key).toContain(m.key);
      expect(credits, m.key).toContain(m.source!.split(":")[1]);
    }
    expect(credits).toContain("CC0");
  });

  it("the whole texture folder stays small enough to ship", () => {
    let total = 0;
    for (const f of readdirSync(TEXTURES, { recursive: true }) as string[]) {
      const p = path.join(TEXTURES, f);
      if (statSync(p).isFile()) total += statSync(p).size;
    }
    expect(total).toBeLessThan(12 * 1024 * 1024);
  });

  it("the materials other 3D builders rely on exist", () => {
    for (const k of ["porcelain_white", "porcelain_grey", "marble_white", "terrazzo", "ceramic_beige", "wood_oak", "roof_sheet", "ground_grass", "ground_paving", "ground_sand", "glass", "galvanised", "concrete_smooth", "concrete_precast", "alu_dark", "roof_membrane", "wood_door"]) {
      expect(getMaterialDef(k), k).not.toBeNull();
    }
    expect(isVisualValue("#aabbcc")).toBe(true);
    expect(isVisualValue("not_a_material")).toBe(false);
  });
});
