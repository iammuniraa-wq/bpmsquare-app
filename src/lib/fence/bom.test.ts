import { describe, it, expect } from "vitest";
import { computeGeometry, type FenceGeometryInput, type FenceGeometryResult } from "./geometry";
import { computeBom, type FenceAccessories } from "./bom";

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
const allOff: FenceAccessories = { truss_rods: false, tension_wire: false, tie_wire: false, barbed_wire: false };

function lineFor(lines: ReturnType<typeof computeBom>, kind: string) {
  return lines.find((l) => l.kind === kind);
}

describe("computeBom", () => {
  const geometry = computeGeometry(bigBlueYard);

  it("scopes hardware to terminal-type posts only (corner + terminal + straining + gate), never line posts", () => {
    const lines = computeBom({ geometry, fabric_height_m: 2, total_length_m: 500, accessories: allOn });
    const terminalTypePosts = geometry.corner_posts + geometry.terminal_posts + geometry.straining_posts + geometry.gate_posts;
    // 2m fabric height / 0.3m spacing -> 7 bands/post minimum, clamped to >= 3
    const bandsPerPost = Math.max(3, Math.ceil(2 / 0.3));
    expect(lineFor(lines, "tension_band")?.qty).toBe(terminalTypePosts * bandsPerPost);
    expect(lineFor(lines, "brace_band")?.qty).toBe(terminalTypePosts * 2);
  });

  it("carriage bolt sets equal tension bands plus brace bands (one bolt per band)", () => {
    const lines = computeBom({ geometry, fabric_height_m: 2, total_length_m: 500, accessories: allOn });
    const bolts = lineFor(lines, "carriage_bolt_set")!.qty;
    expect(bolts).toBe(lineFor(lines, "tension_band")!.qty + lineFor(lines, "brace_band")!.qty);
  });

  it("omits every optional accessory line when its toggle is off, rather than emitting a zero-qty row", () => {
    const lines = computeBom({ geometry, fabric_height_m: 2, total_length_m: 500, accessories: allOff });
    expect(lineFor(lines, "truss_rod_set")).toBeUndefined();
    expect(lineFor(lines, "tension_wire")).toBeUndefined();
    expect(lineFor(lines, "tie_wire")).toBeUndefined();
    expect(lineFor(lines, "barbed_wire")).toBeUndefined();
    // the four base hardware lines are never optional
    expect(lineFor(lines, "tension_band")).toBeDefined();
    expect(lineFor(lines, "brace_band")).toBeDefined();
    expect(lineFor(lines, "rail_end")).toBeDefined();
    expect(lineFor(lines, "carriage_bolt_set")).toBeDefined();
  });

  it("truss rods land only at corners and straining posts, never at gates or open-run terminals", () => {
    const lines = computeBom({ geometry, fabric_height_m: 2, total_length_m: 500, accessories: allOn });
    expect(lineFor(lines, "truss_rod_set")?.qty).toBe(geometry.corner_posts + geometry.straining_posts);
  });

  it("tension wire runs 3 rows the full length; tie wire scales by weight-per-metre, both only when enabled", () => {
    const lines = computeBom({ geometry, fabric_height_m: 2, total_length_m: 500, accessories: allOn });
    expect(lineFor(lines, "tension_wire")?.qty).toBe(1500); // 500m * 3 rows
    expect(lineFor(lines, "tie_wire")?.qty).toBeCloseTo(9.3, 1); // 500m * 0.0186 kg/m
  });

  it("barbed wire runs 3 strands the full length when enabled", () => {
    const lines = computeBom({ geometry, fabric_height_m: 2, total_length_m: 500, accessories: allOn });
    expect(lineFor(lines, "barbed_wire")?.qty).toBe(1500);
  });

  it("never produces a negative or NaN quantity for a degenerate open run with no anchors beyond the two terminals", () => {
    const open: FenceGeometryResult = computeGeometry({ ...bigBlueYard, layout: "open_run", gates: [] });
    const lines = computeBom({ geometry: open, fabric_height_m: 1, total_length_m: 500, accessories: allOn });
    lines.forEach((l) => {
      expect(Number.isFinite(l.qty)).toBe(true);
      expect(l.qty).toBeGreaterThanOrEqual(0);
    });
  });
});
