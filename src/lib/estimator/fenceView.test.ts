import { describe, expect, it } from "vitest";
import { computeEstimate } from "./compute";
import { fenceViewOf } from "./fenceView";
import { CHAINLINK_FENCE_STARTER, PRECAST_VILLA_STARTER } from "./starterTemplates";
import { computeGeometry } from "../fence/geometry";

describe("fenceViewOf", () => {
  const run = (params: Record<string, unknown>) => {
    const r = computeEstimate(CHAINLINK_FENCE_STARTER, params);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r;
  };

  it("hands the 3D scene the configurator's own geometry, read back from the model", () => {
    const r = run({});
    const v = fenceViewOf(r.model, CHAINLINK_FENCE_STARTER.inputs, r.params)!;
    const g = computeGeometry({
      layout: "closed_perimeter", total_length_m: 500, post_spacing_m: 3, embedment_m: 0.9, straining_spacing_m: 100,
      gates: [{ type: "double_swing", width_m: 5 }, { type: "double_swing", width_m: 5 }], fabric_height_m: 2,
    });
    expect(v.geometry.line_posts).toBe(g.line_posts);
    expect(v.geometry.total_posts).toBe(g.total_posts);
    expect(v.geometry.fabric_area_m2).toBeCloseTo(g.fabric_area_m2, 3);
    expect(v.geometry.gate_width_sum_m).toBeCloseTo(g.gate_width_sum_m, 3);
    expect(v.layout).toBe("closed_perimeter");
    expect(v.totalLength).toBe(500);
    expect(v.gates).toEqual([{ type: "double_swing", width_m: 5 }, { type: "double_swing", width_m: 5 }]);
    expect(v.posts).toHaveLength(g.total_posts);
    expect(v.gatePoints).toHaveLength(2);
  });

  it("reads the mesh and coating the customer chose, and an open run", () => {
    const r = run({ closed_perimeter: false, mesh: "mini_mesh", total_length_m: 80, gates_double_n: 0 });
    const v = fenceViewOf(r.model, CHAINLINK_FENCE_STARTER.inputs, r.params)!;
    expect(v.layout).toBe("open_run");
    expect(v.meshSpec).toBe("Chain-link 16x16 . 4.9mm (mini-mesh)");
    expect(v.coating).toBe("PVC coated");
    expect(v.gates).toEqual([]);
  });

  it("is null for a model that is not a fence, or no model", () => {
    const villa = computeEstimate(PRECAST_VILLA_STARTER, null);
    expect(villa.ok && fenceViewOf(villa.model, PRECAST_VILLA_STARTER.inputs, villa.params)).toBeNull();
    expect(fenceViewOf(null, [], {})).toBeNull();
  });
});
