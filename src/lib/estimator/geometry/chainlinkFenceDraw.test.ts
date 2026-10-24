import { describe, expect, it } from "vitest";
import { CHAINLINK_FENCE_MODULE, CHAINLINK_FENCE_SLOTS, CHAINLINK_FENCE_SLOT_BY_CODE, placeGate } from "./chainlinkFence";
import {
  DIAMOND_PITCH_M, diamondRepeat, fencePosts, fenceRuns, footingRadius, gateAngle, gateKind, gatePostPair, postRadius,
} from "./chainlinkFenceDraw";
import { PRECAST_SLOT_BY_CODE, PRECAST_VILLA_MODULE, PRECAST_VILLA_SLOTS, layoutPrecastVilla } from "./precastVilla";
import { defaultSlotForCode, slotForPiece, slotValue } from "./pieceSlots";
import { getMaterialDef, isVisualValue } from "../materialCatalog";
import type { GeometryModel } from "./types";

function lay(inputs: Record<string, number>): GeometryModel {
  const r = CHAINLINK_FENCE_MODULE.layout(inputs);
  if (!r.ok) throw new Error(r.error);
  return r.model;
}

const closed = { total_length_m: 200, closed_perimeter: 1, post_spacing_m: 3, fabric_height_m: 2, gates_single_n: 1, gates_single_w: 1.2, gates_double_n: 1, gates_double_w: 4 };
const open = { total_length_m: 60, closed_perimeter: 0, post_spacing_m: 3, fabric_height_m: 1.8, gates_sliding_n: 1, gates_sliding_w: 6 };

describe("fence drawing helpers", () => {
  it("a diamond is 50 mm and the repeat follows the run", () => {
    expect(DIAMOND_PITCH_M).toBe(0.05);
    expect(diamondRepeat(3, 2)).toEqual([60, 40]);
    expect(diamondRepeat(0, 0)).toEqual([1, 1]);
  });

  it("fabric runs join neighbouring posts and leave a gap at each gate", () => {
    const m = lay(closed);
    const posts = fencePosts(m);
    const gates = m.pieces.filter((p) => p.code === "GT");
    expect(gates).toHaveLength(2);
    const runs = fenceRuns(m);
    // a closed fence has one run per post; each gate opening removes one
    expect(runs).toHaveLength(posts.length - gates.length);
    for (const r of runs) {
      expect(r.len).toBeGreaterThan(0.05);
      expect(Number.isFinite(r.rot) && Number.isFinite(r.mx) && Number.isFinite(r.mz)).toBe(true);
    }
  });

  it("an open run has one run fewer than posts, less the gates", () => {
    const m = lay(open);
    expect(fenceRuns(m)).toHaveLength(fencePosts(m).length - 1 - 1);
  });

  it("each gate stands between its own two gate posts", () => {
    for (const inputs of [closed, open]) {
      const m = lay(inputs);
      const posts = fencePosts(m);
      for (const g of m.pieces.filter((p) => p.code === "GT")) {
        const pair = gatePostPair(posts, g)!;
        expect(pair).not.toBeNull();
        const [a, b] = pair.map((i) => posts[i]);
        expect(a.code).toBe("GP");
        expect(b.code).toBe("GP");
        expect(g.pos[0]).toBeCloseTo((a.pos[0] + b.pos[0]) / 2, 2);
        expect(g.pos[2]).toBeCloseTo((a.pos[2] + b.pos[2]) / 2, 2);
        // the posts straddle the gate along its own direction
        const dx = b.pos[0] - a.pos[0];
        const dz = b.pos[2] - a.pos[2];
        expect(gateAngle(m, g)).toBeCloseTo(-Math.atan2(dz, dx), 3);
      }
    }
  });

  it("gates carry their type", () => {
    const m = lay({ ...closed, gates_sliding_n: 1, gates_sliding_w: 6 });
    expect(m.pieces.filter((p) => p.code === "GT").map(gateKind)).toEqual(["single_swing", "double_swing", "sliding"]);
  });

  it("a gate stored before types existed is read from its width", () => {
    const base = lay({ ...open }).pieces.find((p) => p.code === "GT")!;
    const old = { ...base, item: undefined, rot: undefined };
    expect(gateKind({ ...old, dims: { ...old.dims, w: 1 } })).toBe("single_swing");
    expect(gateKind({ ...old, dims: { ...old.dims, w: 4 } })).toBe("double_swing");
    expect(gateKind({ ...old, dims: { ...old.dims, w: 6 } })).toBe("sliding");
  });

  it("placeGate straddles the width but never runs over a neighbouring post", () => {
    const p = placeGate({ x: 0, z: 0 }, { x: 3, z: 0 }, 4, 3);
    expect(p.mid).toEqual({ x: 1.5, z: 0 });
    expect(p.b.x - p.a.x).toBeCloseTo(4, 6);
    expect(p.rot).toBeCloseTo(0, 6);
    const huge = placeGate({ x: 0, z: 0 }, { x: 3, z: 0 }, 40, 3);
    expect(huge.b.x - huge.a.x).toBeCloseTo(3 + 2 * 0.8 * 3, 6);
    const narrow = placeGate({ x: 0, z: 0 }, { x: 3, z: 0 }, 1, 3);
    expect(narrow.b.x - narrow.a.x).toBeCloseTo(1, 6);
    const along = placeGate({ x: 0, z: 0 }, { x: 0, z: 3 }, 2, 3);
    expect(along.rot).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("post and footing sizes grow with the strain a post carries", () => {
    expect(postRadius("LP")).toBeLessThan(postRadius("CP"));
    expect(postRadius("CP")).toBeLessThan(postRadius("GP"));
    expect(footingRadius("LP")).toBeLessThan(footingRadius("GP"));
  });
});

describe("design slots", () => {
  it("every piece family of both modules has a slot, and every slot a catalogue material", () => {
    for (const code of CHAINLINK_FENCE_MODULE.piece_codes.map((c) => c.code)) expect(CHAINLINK_FENCE_SLOT_BY_CODE[code]).toBeTruthy();
    for (const code of PRECAST_VILLA_MODULE.piece_codes.map((c) => c.code)) expect(PRECAST_SLOT_BY_CODE[code]).toBeTruthy();
    const keys = new Set([...CHAINLINK_FENCE_SLOTS, ...PRECAST_VILLA_SLOTS].map((s) => s.key));
    for (const s of [...CHAINLINK_FENCE_SLOTS, ...PRECAST_VILLA_SLOTS]) expect(isVisualValue(s.default), `${s.key} -> ${s.default}`).toBe(true);
    for (const slot of [...Object.values(CHAINLINK_FENCE_SLOT_BY_CODE), ...Object.values(PRECAST_SLOT_BY_CODE)]) expect(keys.has(slot)).toBe(true);
  });

  it("the modules declare their slots and the fence defaults are as designed", () => {
    expect(PRECAST_VILLA_MODULE.slots).toBe(PRECAST_VILLA_SLOTS);
    expect(CHAINLINK_FENCE_MODULE.slots).toBe(CHAINLINK_FENCE_SLOTS);
    expect(CHAINLINK_FENCE_SLOTS.map((s) => [s.key, s.default])).toEqual([
      ["posts", "galvanised"], ["mesh", "galvanised"], ["footing", "concrete_smooth"], ["gate", "galvanised"], ["ground", "ground_sand"],
    ]);
    expect(PRECAST_VILLA_SLOTS.find((s) => s.key === "wall")?.default).toBe("concrete_precast");
    expect(getMaterialDef("concrete_precast")?.textured).toBe(true);
  });

  it("a piece's own slot wins, else the module's family default", () => {
    expect(defaultSlotForCode("precast_villa", "EW")).toBe("wall");
    expect(defaultSlotForCode("precast_villa", "SL")).toBe("slab");
    expect(defaultSlotForCode("chainlink_fence", "GT")).toBe("gate");
    expect(defaultSlotForCode("chainlink_fence", "NOPE")).toBeNull();
    expect(defaultSlotForCode("__proto__", "EW")).toBeNull();
    expect(slotForPiece("precast_villa", { code: "EW", slot: "boundary" })).toBe("boundary");
    expect(slotForPiece("precast_villa", { code: "BW" })).toBe("boundary");
  });

  it("slotValue prefers the chosen visual, then the slot default", () => {
    expect(slotValue(PRECAST_VILLA_SLOTS, { wall: "#ffeecc" }, "wall")).toBe("#ffeecc");
    expect(slotValue(PRECAST_VILLA_SLOTS, {}, "wall")).toBe("concrete_precast");
    expect(slotValue(PRECAST_VILLA_SLOTS, undefined, "stair")).toBe("concrete_smooth");
    expect(slotValue(PRECAST_VILLA_SLOTS, {}, "nope")).toBeNull();
    expect(slotValue(undefined, { glazing: "glass" }, "glazing")).toBe("glass");
  });

  it("layouts are unchanged by slots: pieces carry no slot of their own", () => {
    const r = layoutPrecastVilla({ floors: 2, built_up_area_m2: 150, wall_perimeter_m: 50, wall_height_m: 3, ext_wall_thickness_m: 0.2, stair_flights: 2, boundary_wall_length_m: 60 });
    expect(r.ok && r.model.pieces.every((p) => p.slot === undefined)).toBe(true);
  });
});
