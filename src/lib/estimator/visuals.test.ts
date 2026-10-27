import { describe, it, expect } from "vitest";
import { resolveVisuals, sameVisuals, visualSwatch } from "./visuals";
import type { DesignSlot } from "./geometry/types";
import type { TemplateInput } from "./types";

const slots: DesignSlot[] = [
  { key: "mesh", label: "Mesh", default: "galvanised" },
  { key: "posts", label: "Posts", default: "#444444" },
];

const meshInput: TemplateInput = {
  key: "mesh_colour", label: "Mesh colour", type: "select", default: "green", paints: "mesh",
  options: [
    { key: "galv", label: "Galvanised", value: 1, visual: "galvanised" },
    { key: "green", label: "Green", value: 2, visual: "pvc_green" },
    { key: "custom", label: "Custom", value: 3, visual: "#ABCDEF" },
    { key: "bad", label: "Bad", value: 4, visual: "not-a-material" },
    { key: "plain", label: "Plain", value: 5 },
  ],
};

describe("resolveVisuals", () => {
  it("starts from the slot defaults", () => {
    expect(resolveVisuals(slots, [], {})).toEqual({ mesh: "galvanised", posts: "#444444" });
  });

  it("uses the input default when no value is chosen, then the chosen option", () => {
    expect(resolveVisuals(slots, [meshInput], {}).mesh).toBe("pvc_green");
    expect(resolveVisuals(slots, [meshInput], { mesh_colour: "galv" }).mesh).toBe("galvanised");
    expect(resolveVisuals(slots, [meshInput], { mesh_colour: "custom" }).mesh).toBe("#ABCDEF");
  });

  it("falls back to the slot default for an unknown choice, an invalid visual or an option with none", () => {
    for (const v of ["nope", "bad", "plain"]) expect(resolveVisuals(slots, [meshInput], { mesh_colour: v }).mesh).toBe("galvanised");
  });

  it("ignores a non-select input and a slot the module does not declare", () => {
    const number: TemplateInput = { key: "n", label: "N", type: "number", default: 1, paints: "mesh" };
    expect(resolveVisuals(slots, [number], { n: 5 })).toEqual({ mesh: "galvanised", posts: "#444444" });
    const unknown: TemplateInput = { ...meshInput, key: "u", paints: "roof" };
    expect(resolveVisuals(slots, [unknown], {})).toEqual({ mesh: "galvanised", posts: "#444444" });
  });

  it("returns nothing for a module with no slots", () => {
    expect(resolveVisuals(undefined, [meshInput], {})).toEqual({});
  });
});

describe("visualSwatch and sameVisuals", () => {
  it("describes a material, a colour and nothing", () => {
    expect(visualSwatch("pvc_green")).toEqual({ colour: "#2f6b45", label: "Green PVC coating", textured: false });
    expect(visualSwatch("concrete_precast")?.textured).toBe(true);
    expect(visualSwatch("#d9ccb4")).toEqual({ colour: "#d9ccb4", label: "#d9ccb4", textured: false });
    expect(visualSwatch("nope")).toBeNull();
    expect(visualSwatch(undefined)).toBeNull();
  });

  it("compares by content", () => {
    expect(sameVisuals({ a: "x" }, { a: "x" })).toBe(true);
    expect(sameVisuals({ a: "x" }, { a: "y" })).toBe(false);
    expect(sameVisuals({ a: "x" }, { a: "x", b: "y" })).toBe(false);
    expect(sameVisuals(undefined, {})).toBe(false);
    expect(sameVisuals(undefined, undefined)).toBe(true);
  });
});
