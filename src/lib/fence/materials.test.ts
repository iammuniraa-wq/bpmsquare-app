import { describe, it, expect } from "vitest";
import { computeGeometry, type FenceGeometryInput } from "./geometry";
import { computeBom, type FenceAccessories } from "./bom";
import { buildMaterialRequests } from "./materials";

const bigBlueYard: FenceGeometryInput = {
  layout: "closed_perimeter",
  total_length_m: 500,
  post_spacing_m: 3,
  embedment_m: 0.9,
  straining_spacing_m: 100,
  gates: [
    { type: "double_swing", width_m: 6 },
    { type: "double_swing", width_m: 4 },
  ],
  fabric_height_m: 2,
};
const allOn: FenceAccessories = { truss_rods: true, tension_wire: true, tie_wire: true, barbed_wire: true };

describe("buildMaterialRequests", () => {
  const geometry = computeGeometry(bigBlueYard);
  const bom = computeBom({ geometry, fabric_height_m: 2, total_length_m: 500, accessories: allOn });
  const requests = buildMaterialRequests(geometry, bom);

  it("includes every post type present and skips zero-qty ones (terminal_post is 0 for a closed perimeter)", () => {
    const kinds = requests.map((r) => r.fence_kind);
    expect(kinds).toContain("line_post");
    expect(kinds).toContain("straining_post");
    expect(kinds).toContain("corner_post");
    expect(kinds).toContain("gate_post");
    expect(kinds).not.toContain("terminal_post");
  });

  it("carries the geometry engine's own numbers through unchanged, not recomputed", () => {
    const linePost = requests.find((r) => r.fence_kind === "line_post");
    expect(linePost?.qty).toBe(geometry.line_posts);
    expect(linePost?.uom).toBe("pcs");
    const fabric = requests.find((r) => r.fence_kind === "fabric");
    expect(fabric?.qty).toBe(geometry.fabric_area_m2);
    expect(fabric?.uom).toBe("m2");
  });

  it("carries every BOM hardware line through with the BOM's own unit", () => {
    const tensionWire = requests.find((r) => r.fence_kind === "tension_wire");
    expect(tensionWire?.qty).toBe(1500);
    expect(tensionWire?.uom).toBe("m");
    const bolts = requests.find((r) => r.fence_kind === "carriage_bolt_set");
    expect(bolts?.uom).toBe("sets");
  });

  it("produces exactly one request per non-zero kind -- no duplicates", () => {
    const kinds = requests.map((r) => r.fence_kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
