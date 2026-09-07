import { describe, it, expect } from "vitest";
import { computeGeometry, type FenceGeometryInput } from "./geometry";

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

describe("computeGeometry", () => {
  it("gives a closed perimeter 4 corners and 0 terminals, and the reverse for an open run", () => {
    const closed = computeGeometry(bigBlueYard);
    expect(closed.corner_posts).toBe(4);
    expect(closed.terminal_posts).toBe(0);

    const open = computeGeometry({ ...bigBlueYard, layout: "open_run" });
    expect(open.corner_posts).toBe(0);
    expect(open.terminal_posts).toBe(2);
  });

  it("adds 2 gate posts per gate", () => {
    const result = computeGeometry(bigBlueYard);
    expect(result.gate_posts).toBe(4); // 2 gates
  });

  it("fabric area subtracts gate spans, matching the walkthrough's real 980 m² for this exact input", () => {
    const result = computeGeometry(bigBlueYard);
    // 500m * 2m - (6+4)m * 2m = 1000 - 20 = 980
    expect(result.fabric_area_m2).toBe(980);
    expect(result.gate_width_sum_m).toBe(10);
  });

  it("total_posts is the sum of every post type, always", () => {
    const result = computeGeometry(bigBlueYard);
    const sum = result.line_posts + result.straining_posts + result.corner_posts + result.terminal_posts + result.gate_posts;
    expect(result.total_posts).toBe(sum);
  });

  it("never goes negative when spacing is coarser than the anchor count needs", () => {
    const result = computeGeometry({ ...bigBlueYard, total_length_m: 20, post_spacing_m: 10, gates: [{ type: "single_swing", width_m: 3 }] });
    expect(result.line_posts).toBeGreaterThanOrEqual(0);
    expect(result.straining_posts).toBeGreaterThanOrEqual(0);
  });

  it("rejects non-positive geometry inputs", () => {
    expect(() => computeGeometry({ ...bigBlueYard, total_length_m: 0 })).toThrow(RangeError);
    expect(() => computeGeometry({ ...bigBlueYard, post_spacing_m: -1 })).toThrow(RangeError);
    expect(() => computeGeometry({ ...bigBlueYard, embedment_m: 0 })).toThrow(RangeError);
  });
});
