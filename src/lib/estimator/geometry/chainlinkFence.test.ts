import { describe, expect, it } from "vitest";
import { computeGeometry } from "../../fence/geometry";
import { CHAINLINK_FENCE_MODULE, MAX_FENCE_POSTS, fenceGatesFromInputs } from "./chainlinkFence";
import { GEOMETRY_KEYS, getGeometry, pieceScope, geometryIdentifiers } from "./index";

const base = { total_length_m: 500, closed_perimeter: 1, post_spacing_m: 3, fabric_height_m: 2, gates_double_n: 2, gates_double_w: 5 };

function lay(inputs: Record<string, number>) {
  const r = CHAINLINK_FENCE_MODULE.layout(inputs);
  if (!r.ok) throw new Error(r.error);
  return r.model;
}

describe("chainlink_fence geometry module", () => {
  it("is registered", () => {
    expect(GEOMETRY_KEYS).toContain("chainlink_fence");
    expect(getGeometry("chainlink_fence")).toBe(CHAINLINK_FENCE_MODULE);
  });

  it("exposes the n_/area_ identifiers the template reads", () => {
    const ids = geometryIdentifiers(CHAINLINK_FENCE_MODULE);
    for (const id of ["n_LP", "n_SP", "n_CP", "n_TP", "n_GP", "area_FB", "n_GT", "area_GT"]) expect(ids).toContain(id);
  });

  it("returns exactly the post counts and fabric area of src/lib/fence/geometry.ts", () => {
    const m = lay(base);
    const scope = pieceScope(CHAINLINK_FENCE_MODULE, m, 2.4);
    const g = computeGeometry({
      layout: "closed_perimeter", total_length_m: 500, post_spacing_m: 3, embedment_m: 0.9, straining_spacing_m: 100,
      gates: [{ type: "double_swing", width_m: 5 }, { type: "double_swing", width_m: 5 }], fabric_height_m: 2,
    });
    expect(scope.n_LP).toBe(g.line_posts);
    expect(scope.n_SP).toBe(g.straining_posts);
    expect(scope.n_CP).toBe(g.corner_posts);
    expect(scope.n_TP).toBe(g.terminal_posts);
    expect(scope.n_GP).toBe(g.gate_posts);
    expect(scope.area_FB).toBeCloseTo(g.fabric_area_m2, 3);
    expect(scope.n_GT).toBe(2);
    expect(scope.area_GT).toBeCloseTo(20, 3);
    expect(m.pieces.filter((p) => ["LP", "SP", "CP", "TP", "GP"].includes(p.code))).toHaveLength(g.total_posts);
  });

  it("an open run has two terminal posts and no corners; a closed one the reverse", () => {
    const open = pieceScope(CHAINLINK_FENCE_MODULE, lay({ ...base, closed_perimeter: 0 }), 2.4);
    expect([open.n_TP, open.n_CP]).toEqual([2, 0]);
    const closed = pieceScope(CHAINLINK_FENCE_MODULE, lay(base), 2.4);
    expect([closed.n_TP, closed.n_CP]).toEqual([0, 4]);
  });

  it("marks are unique and positions are finite", () => {
    const m = lay(base);
    expect(new Set(m.pieces.map((p) => p.id)).size).toBe(m.pieces.length);
    for (const p of m.pieces) for (const v of p.pos) expect(Number.isFinite(v)).toBe(true);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(lay(base))).toBe(JSON.stringify(lay(base)));
  });

  it("uses defaults for optional inputs", () => {
    const m = lay({ total_length_m: 100 });
    expect(pieceScope(CHAINLINK_FENCE_MODULE, m, 2.4).n_GT).toBe(0);
  });

  it("refuses bad input in words instead of throwing", () => {
    expect(CHAINLINK_FENCE_MODULE.layout({ total_length_m: 0 })).toMatchObject({ ok: false });
    expect(CHAINLINK_FENCE_MODULE.layout({ total_length_m: -5 })).toMatchObject({ ok: false });
    expect(CHAINLINK_FENCE_MODULE.layout({ total_length_m: 100, fabric_height_m: 0 })).toMatchObject({ ok: false });
    expect(CHAINLINK_FENCE_MODULE.layout({ total_length_m: 100, gates_single_n: 3, gates_single_w: 0 })).toMatchObject({ ok: false });
    expect(CHAINLINK_FENCE_MODULE.layout({ total_length_m: 100, gates_single_n: 99 })).toMatchObject({ ok: false });
    const huge = CHAINLINK_FENCE_MODULE.layout({ total_length_m: 5000, post_spacing_m: 0.5 });
    expect(huge.ok).toBe(false);
    expect(!huge.ok && huge.error).toContain(String(MAX_FENCE_POSTS));
  });

  it("warns when the gates take the whole fence", () => {
    const r = CHAINLINK_FENCE_MODULE.layout({ total_length_m: 4, closed_perimeter: 0, gates_double_n: 1, gates_double_w: 5 });
    expect(r.ok && r.model.warnings.join(" ")).toMatch(/no fabric/);
    expect(r.ok && pieceScope(CHAINLINK_FENCE_MODULE, r.model, 2.4).area_FB).toBe(0);
  });

  it("reads the gates the same way the viewer does", () => {
    expect(fenceGatesFromInputs({ gates_single_n: 1, gates_single_w: 1.2, gates_sliding_n: 2, gates_sliding_w: 6 })).toEqual([
      { type: "single_swing", width_m: 1.2 }, { type: "sliding", width_m: 6 }, { type: "sliding", width_m: 6 },
    ]);
    expect(fenceGatesFromInputs({})).toEqual([]);
  });
});
