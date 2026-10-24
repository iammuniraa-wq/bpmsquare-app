// Porta cabin rooms and equipment (cabinEquipment.ts, cabinRooms.ts, portaCabin.ts). The plain cabin's own
// tests are in portaCabin.test.ts; the tests here also prove that a cabin with no room plan did not change.

import { describe, it, expect } from "vitest";
import { layoutPortaCabin, PORTA_CABIN_MODULE, MAX_PIECES, LAYOUT_SINGLE, LAYOUT_ROW, LAYOUT_L, LAYOUT_STACKED } from "./portaCabin";
import { CABIN_EQUIPMENT, ROOM_TYPES, getCabinEquipment, planRooms } from "./cabinEquipment";
import { getGeometry, geometryIdentifiers, pieceScope, familyTotals } from "./index";
import { isVisualValue } from "../materialCatalog";
import type { GeometryModel, Piece } from "./types";

const UNIT = { unit_length_m: 6, unit_width_m: 2.4, unit_height_m: 2.6, units_along: 1, units_across: 1, layout: LAYOUT_SINGLE, door_count: 1, window_count: 2, partition_count: 0 };

function build(over: Record<string, number> = {}): GeometryModel {
  const r = layoutPortaCabin({ ...UNIT, ...over });
  if (!r.ok) throw new Error(r.error);
  return r.model;
}
const x = (m: GeometryModel, k: string): number => m.extras![k];

const WALL_T = 0.075;
type Box3 = { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number };
const boxOf = (p: Piece): Box3 => {
  const swap = Math.abs(Math.abs(p.rot ?? 0) - Math.PI / 2) < 1e-3;
  const hx = (swap ? p.dims.t : p.dims.w) / 2;
  const hz = (swap ? p.dims.w : p.dims.t) / 2;
  return { x0: p.pos[0] - hx, x1: p.pos[0] + hx, z0: p.pos[2] - hz, z1: p.pos[2] + hz, y0: p.pos[1] - p.dims.h / 2, y1: p.pos[1] + p.dims.h / 2 };
};
const hit = (a: Box3, b: Box3, eps = 1e-3): boolean =>
  a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.z0 < b.z1 - eps && b.z0 < a.z1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
const eqOf = (m: GeometryModel): Piece[] => m.pieces.filter((p) => p.code === "EQ");
const countItem = (m: GeometryModel, item: string): number => eqOf(m).filter((p) => p.item === item).length;

const ROOMS_OFFICE = 1;
const ROOMS_ACCOMMODATION = 2;
const ROOMS_TOILET_BLOCK = 3;
const ROOMS_SITE_OFFICE_WC = 4;
const ROOMS_CUSTOM = 5;

/** Everything that must hold for any room plan: counts exact, nothing through a wall, nothing on top of anything else. */
function checkRoomModel(m: GeometryModel): void {
  const eq = eqOf(m);
  expect(new Set(m.pieces.map((p) => p.id)).size).toBe(m.pieces.length);
  // The counts the bill reads are exactly the pieces drawn.
  const counted = Object.keys(m.extras!).filter((n) => n.startsWith("n_eq_"));
  for (const k of counted) expect(m.extras![k]).toBe(countItem(m, k.slice(5)));
  expect(counted.reduce((a, k) => a + m.extras![k], 0)).toBe(eq.length);
  expect(new Set(eq.map((p) => p.room)).size).toBeLessThanOrEqual(m.extras!.n_room);

  const clashes: string[] = [];
  const floors = m.pieces.filter((p) => p.code === "FL");
  const walls = m.pieces.filter((p) => p.code === "WL" || p.code === "PT");
  for (const p of eq) {
    expect(p.kind).toBe("equip");
    expect(p.slot).toBe("equipment");
    expect(typeof p.item).toBe("string");
    expect(typeof p.room).toBe("string");
    const b = boxOf(p);
    if (p.item === "ac_outdoor") {
      // Hangs outside: its centre is over no floor of its storey.
      expect(floors.some((f) => f.floor === p.floor && Math.abs(p.pos[0] - f.pos[0]) < f.dims.w / 2 && Math.abs(p.pos[2] - f.pos[2]) < f.dims.t / 2)).toBe(false);
    } else {
      // Inside the room: within the floor of its unit, clear of the wall thickness.
      const f = floors.find((fl) => fl.floor === p.floor && Math.abs(p.pos[0] - fl.pos[0]) < fl.dims.w / 2 && Math.abs(p.pos[2] - fl.pos[2]) < fl.dims.t / 2);
      expect(f, `${p.id} stands on a floor`).toBeDefined();
      const inset = WALL_T / 2 - 1e-3;
      expect(b.x0).toBeGreaterThanOrEqual(f!.pos[0] - f!.dims.w / 2 + inset);
      expect(b.x1).toBeLessThanOrEqual(f!.pos[0] + f!.dims.w / 2 - inset);
      expect(b.z0).toBeGreaterThanOrEqual(f!.pos[2] - f!.dims.t / 2 + inset);
      expect(b.z1).toBeLessThanOrEqual(f!.pos[2] + f!.dims.t / 2 - inset);
    }
    for (const w of walls) if (hit(b, boxOf(w))) clashes.push(`${p.id} through ${w.id}`);
  }
  const boxes = eq.map(boxOf);
  for (let i = 0; i < eq.length; i++) for (let j = i + 1; j < eq.length; j++) if (hit(boxes[i], boxes[j])) clashes.push(`${eq[i].id} on ${eq[j].id}`);

  // The swing of every door stays clear of low furniture: 0.9 m inside an outside door, half a metre either side of a partition door.
  for (const d of m.pieces.filter((p) => p.op?.door)) {
    const floorTop = d.pos[1] - d.dims.h / 2;
    let zone: Box3;
    if (d.code === "PT") {
      zone = { x0: d.pos[0] - 0.5, x1: d.pos[0] + 0.5, z0: d.pos[2] - d.op!.w / 2, z1: d.pos[2] + d.op!.w / 2, y0: floorTop, y1: floorTop + 2 };
    } else {
      const f = floors.find((fl) => fl.floor === d.floor && Math.abs(d.pos[0] - fl.pos[0]) <= fl.dims.w / 2 + 0.05 && Math.abs(d.pos[2] - fl.pos[2]) <= fl.dims.t / 2 + 0.05)!;
      if ((d.rot ?? 0) === 0) {
        const dir = d.pos[2] > f.pos[2] ? -1 : 1;
        zone = { x0: d.pos[0] - d.op!.w / 2, x1: d.pos[0] + d.op!.w / 2, z0: Math.min(d.pos[2], d.pos[2] + dir * 0.9), z1: Math.max(d.pos[2], d.pos[2] + dir * 0.9), y0: floorTop, y1: floorTop + 2 };
      } else {
        const dir = d.pos[0] > f.pos[0] ? -1 : 1;
        zone = { z0: d.pos[2] - d.op!.w / 2, z1: d.pos[2] + d.op!.w / 2, x0: Math.min(d.pos[0], d.pos[0] + dir * 0.9), x1: Math.max(d.pos[0], d.pos[0] + dir * 0.9), y0: floorTop, y1: floorTop + 2 };
      }
    }
    for (const p of eq) if (p.item !== "ac_outdoor" && hit(boxOf(p), zone)) clashes.push(`${p.id} in the way of ${d.id}`);
  }
  expect(clashes).toEqual([]);

  // Every indoor air conditioner has its outdoor unit, and the roof is the last thing to go on.
  expect(countItem(m, "ac_outdoor")).toBe(countItem(m, "ac_split"));
  for (const p of eq) {
    expect(m.step_names[p.step]).toMatch(/furniture/i);
    const roof = m.pieces.find((r) => r.code === "RF" && r.floor === p.floor)!;
    expect(roof.step).toBeGreaterThan(p.step);
  }
}

describe("porta_cabin, no room plan stays as it was", () => {
  const m = build();
  const mod = getGeometry("porta_cabin")!;

  it("a single unit is still 10 pieces and the same volume, with no rooms or equipment", () => {
    expect(m.pieces).toHaveLength(10);
    expect(eqOf(m)).toHaveLength(0);
    const s = pieceScope(mod, m, 0.3);
    expect(s.n_total).toBe(10);
    expect(s.vol_total).toBeCloseTo(2.16 + 2.16 + (43.68 - 0.9 * 2 - 2 * 1) * 0.075, 3);
    expect(s.n_EQ).toBe(0);
    expect(s.n_room).toBe(0);
    expect(s.n_door_int).toBe(0);
    expect(Object.keys(s).filter((k) => k.startsWith("n_eq_") && s[k] !== 0)).toEqual([]);
  });

  it("the room inputs do nothing while the plan is None", () => {
    const base = build({ units_along: 3, layout: LAYOUT_ROW, partition_count: 2 });
    const noisy = build({ units_along: 3, layout: LAYOUT_ROW, partition_count: 2, rooms_mode: 0, room_offices: 5, extinguisher_count: 4, water_cooler_count: 2, include_ac: 1 });
    expect(noisy.pieces).toEqual(base.pieces);
    expect(noisy.extras).toEqual(base.extras);
  });

  it("partitions are the plain full-width panels, one piece each, with no door", () => {
    const p = build({ layout: LAYOUT_ROW, units_along: 2, partition_count: 4 });
    expect(familyTotals(p, "PT").n).toBe(4);
    expect(p.pieces.filter((q) => q.code === "PT").every((q) => q.op === null)).toBe(true);
    expect(x(p, "n_door_int")).toBe(0);
  });

  it("names the build steps floor, walls, partitions, roof, so stepping back shows the inside", () => {
    const p = build({ partition_count: 2 });
    expect(p.step_names.slice(1).map((n) => /floor|wall|partition|roof/i.exec(n)![0].toLowerCase())).toEqual(["floor", "wall", "partition", "roof"]);
  });

  it("gives every piece a design slot the module declares", () => {
    const p = build({ partition_count: 2 });
    for (const piece of p.pieces) expect(PORTA_CABIN_MODULE.slots!.map((s) => s.key)).toContain(piece.slot);
    expect(p.pieces.find((q) => q.code === "FL")!.slot).toBe("floor");
    expect(p.pieces.find((q) => q.code === "WL")!.slot).toBe("cladding");
    expect(p.pieces.find((q) => q.code === "RF")!.slot).toBe("roof");
  });
});

describe("porta_cabin, module slots", () => {
  it("declares the six design slots with catalogue defaults", () => {
    const slots = PORTA_CABIN_MODULE.slots!;
    expect(slots.map((s) => s.key)).toEqual(["cladding", "roof", "floor", "frame", "door", "equipment"]);
    for (const s of slots) expect(isVisualValue(s.default), s.key).toBe(true);
    const def = (k: string) => slots.find((s) => s.key === k)!.default;
    expect(def("cladding")).toBe("cladding_white");
    expect(def("roof")).toBe("roof_sheet");
    expect(def("floor")).toBe("porcelain_grey");
    expect(def("frame")).toBe("galvanised");
    expect(def("door")).toBe("wood_door");
  });
});

describe("porta_cabin, equipment catalogue", () => {
  it("has sizes, a mount and (but for the outdoor unit) a rate for every item", () => {
    expect(CABIN_EQUIPMENT.length).toBeGreaterThanOrEqual(14);
    expect(new Set(CABIN_EQUIPMENT.map((i) => i.key)).size).toBe(CABIN_EQUIPMENT.length);
    for (const i of CABIN_EQUIPMENT) {
      expect(i.w).toBeGreaterThan(0);
      expect(i.h).toBeGreaterThan(0);
      expect(i.t).toBeGreaterThan(0);
      expect(/^#[0-9a-f]{6}$/i.test(i.colour)).toBe(true);
      if (i.key !== "ac_outdoor") {
        expect(i.rate).toBeTruthy();
        expect(i.price).toBeGreaterThan(0);
      }
    }
  });

  it("every room type's furniture list names catalogue items", () => {
    for (const r of ROOM_TYPES) {
      for (const l of r.items) {
        expect(getCabinEquipment(l.item), `${r.key}: ${l.item}`).not.toBeNull();
        if (l.withItem) expect(getCabinEquipment(l.withItem)).not.toBeNull();
      }
    }
  });

  it("exposes n_eq_<item>, n_room and n_room_<type> to formulas", () => {
    const ids = geometryIdentifiers(PORTA_CABIN_MODULE);
    for (const i of CABIN_EQUIPMENT) expect(ids).toContain(`n_eq_${i.key}`);
    for (const r of ROOM_TYPES) expect(ids).toContain(`n_room_${r.key}`);
    for (const k of ["n_room", "n_door_int", "n_EQ", "area_EQ"]) expect(ids).toContain(k);
  });
});

describe("porta_cabin, room plans", () => {
  it("planRooms gives every unit at least one room, and none for the plan None", () => {
    expect(planRooms(0, 3, 6)).toEqual([]);
    for (const mode of [ROOMS_OFFICE, ROOMS_ACCOMMODATION, ROOMS_TOILET_BLOCK, ROOMS_SITE_OFFICE_WC, ROOMS_CUSTOM]) {
      for (const n of [1, 2, 3, 7]) {
        for (const UL of [2.4, 4.5, 6, 12.2]) {
          const plan = planRooms(mode, n, UL);
          expect(plan).toHaveLength(n);
          for (const rooms of plan) {
            expect(rooms.length).toBeGreaterThanOrEqual(1);
            expect(rooms.length).toBeLessThanOrEqual(4);
          }
        }
      }
    }
  });

  it("a room is never narrower than its furniture needs", () => {
    for (const UL of [2.4, 3.5, 4.8, 6, 9]) {
      for (const rooms of planRooms(ROOMS_OFFICE, 3, UL)) {
        if (rooms.length > 1) for (const t of rooms) expect(UL / rooms.length).toBeGreaterThanOrEqual(ROOM_TYPES.find((r) => r.key === t)!.minW - 1e-9);
      }
    }
  });

  it("an office block of two units is reception + office, then meeting room + pantry", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_OFFICE, window_count: 4 });
    expect(x(m, "n_room")).toBe(4);
    for (const t of ["reception", "office", "meeting", "pantry"]) expect(x(m, `n_room_${t}`)).toBe(1);
    expect(x(m, "n_partition")).toBe(2);
    expect(familyTotals(m, "PT").n).toBe(4);
    expect(x(m, "n_door_int")).toBe(2);
    expect(x(m, "area_partition")).toBeCloseTo(2 * ((2.4 - 0.15) * 2.6 - 0.8 * 2.0), 4);
    expect(m.warnings).toEqual([]);
    // 3 desks (reception 1, office 2), a chair each and six round the meeting table
    expect(countItem(m, "desk")).toBe(3);
    expect(countItem(m, "chair")).toBe(9);
    expect(countItem(m, "meeting_table")).toBe(1);
    expect(countItem(m, "ac_split")).toBe(3);
    expect(countItem(m, "ac_outdoor")).toBe(3);
    expect(countItem(m, "light")).toBe(7);
    expect(countItem(m, "socket")).toBe(8);
    expect(countItem(m, "pantry_counter")).toBe(1);
    expect(countItem(m, "fridge")).toBe(1);
    expect(countItem(m, "water_heater")).toBe(1);
    expect(countItem(m, "extinguisher")).toBe(1);
    expect(countItem(m, "water_cooler")).toBe(0);
    checkRoomModel(m);
  });

  it("accommodation is bunk beds and wardrobes, with a toilet at the end", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 3, rooms_mode: ROOMS_ACCOMMODATION });
    expect(x(m, "n_room_bedroom")).toBe(5);
    expect(x(m, "n_room_toilet")).toBe(1);
    expect(countItem(m, "bed_bunk")).toBe(5);
    expect(countItem(m, "wardrobe")).toBe(5);
    expect(countItem(m, "wc")).toBe(1);
    expect(countItem(m, "basin")).toBe(1);
    checkRoomModel(m);
  });

  it("a toilet block is toilets and showers, four cubicles to a 6 m unit", () => {
    const m = build({ rooms_mode: ROOMS_TOILET_BLOCK, window_count: 0 });
    expect(x(m, "n_room")).toBe(4);
    expect(x(m, "n_room_toilet")).toBe(2);
    expect(x(m, "n_room_shower")).toBe(2);
    expect(countItem(m, "wc")).toBe(2);
    expect(countItem(m, "basin")).toBe(2);
    expect(countItem(m, "shower")).toBe(2);
    expect(countItem(m, "water_heater")).toBe(2);
    expect(countItem(m, "ac_split")).toBe(0);
    expect(m.warnings).toEqual([]);
    checkRoomModel(m);
  });

  it("a site office with WC is an office and a toilet in the first unit", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_SITE_OFFICE_WC });
    expect(x(m, "n_room_office")).toBe(2);
    expect(x(m, "n_room_toilet")).toBe(1);
    expect(x(m, "n_room_pantry")).toBe(1);
    checkRoomModel(m);
  });

  it("a custom plan lays out the rooms asked for, and the leftover units become stores", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_CUSTOM, room_offices: 2, room_bedrooms: 1, room_toilets: 1 });
    expect(x(m, "n_room_office")).toBe(2);
    expect(x(m, "n_room_bedroom")).toBe(1);
    expect(x(m, "n_room_toilet")).toBe(1);
    expect(x(m, "n_partition")).toBe(2);
    checkRoomModel(m);
    const stores = build({ layout: LAYOUT_ROW, units_along: 3, rooms_mode: ROOMS_CUSTOM, room_offices: 2 });
    expect(x(stores, "n_room_office")).toBe(2);
    expect(x(stores, "n_room_store")).toBe(1);
    expect(countItem(stores, "shelf")).toBe(2);
    checkRoomModel(stores);
    const none = build({ rooms_mode: ROOMS_CUSTOM });
    expect(x(none, "n_room_store")).toBe(1);
    checkRoomModel(none);
  });

  it("says so when a custom plan asks for more rooms than the units hold", () => {
    const m = build({ rooms_mode: ROOMS_CUSTOM, room_offices: 20 });
    expect(x(m, "n_room_office")).toBeLessThan(20);
    expect(m.warnings.join(" ")).toMatch(/rooms fit/i);
    checkRoomModel(m);
  });

  it("the room plan decides the partitions, and says the partition count is not used", () => {
    const m = build({ rooms_mode: ROOMS_OFFICE, partition_count: 5 });
    expect(x(m, "n_partition")).toBe(1);
    expect(m.warnings.join(" ")).toMatch(/partition count is not used/i);
  });

  it("is deterministic", () => {
    const over = { layout: LAYOUT_L, units_along: 3, units_across: 2, rooms_mode: ROOMS_OFFICE };
    expect(layoutPortaCabin({ ...UNIT, ...over })).toEqual(layoutPortaCabin({ ...UNIT, ...over }));
  });
});

describe("porta_cabin, equipment counts and placement", () => {
  it("leaves the air conditioning out when it is not wanted", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_OFFICE, include_ac: 0 });
    expect(countItem(m, "ac_split")).toBe(0);
    expect(countItem(m, "ac_outdoor")).toBe(0);
    expect(m.warnings).toEqual([]);
  });

  it("places the extra extinguishers and coolers asked for, the cooler in the pantry", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_OFFICE, extinguisher_count: 3, water_cooler_count: 1 });
    expect(countItem(m, "extinguisher")).toBe(3);
    expect(countItem(m, "water_cooler")).toBe(1);
    expect(eqOf(m).find((p) => p.item === "water_cooler")!.room).toMatch(/^pantry/);
    expect(countItem(build({ rooms_mode: ROOMS_OFFICE, extinguisher_count: 0 }), "extinguisher")).toBe(0);
    checkRoomModel(m);
  });

  it("each indoor air conditioner is high on an outside wall, with its outdoor unit low on the same wall outside", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 3, rooms_mode: ROOMS_OFFICE });
    const acs = eqOf(m).filter((p) => p.item === "ac_split");
    const outs = eqOf(m).filter((p) => p.item === "ac_outdoor");
    expect(acs).toHaveLength(outs.length);
    for (const a of acs) {
      const o = outs.find((q) => q.room === a.room && Math.abs(q.pos[0] - a.pos[0]) < 1e-3 && Math.abs(q.pos[2] - a.pos[2]) > 0.2 && Math.abs(q.pos[2] - a.pos[2]) < 0.6);
      expect(o, `outdoor unit for ${a.id}`).toBeDefined();
      expect(a.pos[1]).toBeGreaterThan(o!.pos[1]);
    }
  });

  it("puts a bunk bed against a wall, not in the middle of the room", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_ACCOMMODATION });
    const b = boxOf(eqOf(m).find((p) => p.item === "bed_bunk")!);
    const inner = 1.2 - WALL_T / 2;
    const onWall = Math.abs(b.z0 + inner) < 0.06 || Math.abs(inner - b.z1) < 0.06;
    expect(onWall).toBe(true);
  });

  it("gives the rooms that want a window their windows first", () => {
    const m = build({ layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_OFFICE, window_count: 4 });
    expect(x(m, "n_window")).toBe(4);
    expect(m.warnings).toEqual([]);
  });

  it("no door or window opens onto a partition", () => {
    for (const mode of [ROOMS_OFFICE, ROOMS_ACCOMMODATION, ROOMS_TOILET_BLOCK, ROOMS_SITE_OFFICE_WC]) {
      const m = build({ layout: LAYOUT_ROW, units_along: 3, rooms_mode: mode, door_count: 3, window_count: 8 });
      const parts = m.pieces.filter((p) => p.code === "PT");
      for (const w of m.pieces.filter((p) => p.code === "WL" && p.op && (p.rot ?? 0) === 0)) {
        const lo = w.pos[0] - w.op!.w / 2;
        const hi = w.pos[0] + w.op!.w / 2;
        for (const pt of parts) expect(pt.pos[0] < lo + 1e-3 || pt.pos[0] > hi - 1e-3, `${w.id} meets ${pt.id}`).toBe(true);
      }
    }
  });

  it.each([
    ["office block, a row of four", { layout: LAYOUT_ROW, units_along: 4, rooms_mode: ROOMS_OFFICE, door_count: 2, window_count: 6 }],
    ["accommodation, an L", { layout: LAYOUT_L, units_along: 3, units_across: 3, rooms_mode: ROOMS_ACCOMMODATION, door_count: 2, window_count: 6 }],
    ["toilet block, stacked", { layout: LAYOUT_STACKED, units_along: 2, rooms_mode: ROOMS_TOILET_BLOCK, door_count: 2, window_count: 2 }],
    ["site office with WC, stacked", { layout: LAYOUT_STACKED, units_along: 3, rooms_mode: ROOMS_SITE_OFFICE_WC, door_count: 3, window_count: 8 }],
    ["custom on a single unit", { layout: LAYOUT_SINGLE, rooms_mode: ROOMS_CUSTOM, room_offices: 1, room_pantries: 1, door_count: 2 }],
    ["a short 4.5 m unit", { unit_length_m: 4.5, layout: LAYOUT_ROW, units_along: 3, rooms_mode: ROOMS_OFFICE }],
    ["a long 12 m unit, 3.4 m wide", { unit_length_m: 12, unit_width_m: 3.4, layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_OFFICE, window_count: 6 }],
    ["a low 2.3 m ceiling", { unit_height_m: 2.3, layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_ACCOMMODATION }],
    ["a 2.2 m wide unit", { unit_width_m: 2.2, layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_OFFICE }],
  ])("%s: counts exact, everything inside its room and clear of the doors", (_name, over) => {
    checkRoomModel(build(over));
  });

  it("furnishes every room fully with the usual door and windows, in every plan and layout", () => {
    for (const mode of [ROOMS_OFFICE, ROOMS_ACCOMMODATION, ROOMS_TOILET_BLOCK, ROOMS_SITE_OFFICE_WC, ROOMS_CUSTOM]) {
      for (const layout of [LAYOUT_SINGLE, LAYOUT_ROW, LAYOUT_L, LAYOUT_STACKED]) {
        for (const along of [1, 2, 3, 5]) {
          const m = build({ rooms_mode: mode, layout, units_along: along, units_across: 3, door_count: 1, window_count: 2, room_offices: 3, room_bedrooms: 2, room_toilets: 1, room_pantries: 1 });
          expect(m.warnings.filter((w) => /^No room for/.test(w)), `plan ${mode} layout ${layout} along ${along}`).toEqual([]);
          checkRoomModel(m);
        }
      }
    }
  }, 60_000);

  it("anything that cannot be placed is left out and said, never forced through a wall", () => {
    const m = build({ unit_width_m: 2.2, unit_height_m: 2.1, layout: LAYOUT_ROW, units_along: 2, rooms_mode: ROOMS_OFFICE });
    checkRoomModel(m);
    for (const w of m.warnings.filter((s) => /^No room for/.test(s))) expect(w).toMatch(/left out/);
  });

  it("the largest design stays inside MAX_PIECES", () => {
    const m = build({ layout: LAYOUT_STACKED, units_along: 12, rooms_mode: ROOMS_OFFICE, door_count: 20, window_count: 40, extinguisher_count: 10, water_cooler_count: 4 });
    expect(m.pieces.length).toBeLessThanOrEqual(MAX_PIECES);
    expect(x(m, "n_unit")).toBe(24);
    checkRoomModel(m);
  });

  it("a stacked layout furnishes both storeys and builds the upper roof last", () => {
    const m = build({ layout: LAYOUT_STACKED, units_along: 2, rooms_mode: ROOMS_OFFICE });
    expect(new Set(eqOf(m).map((p) => p.floor))).toEqual(new Set([0, 1]));
    const floorTop1 = 0.15 + 2.6 + 0.15 + 0.15;
    for (const p of eqOf(m).filter((q) => q.floor === 1)) expect(p.pos[1]).toBeGreaterThan(floorTop1);
    const lastStep = Math.max(...m.pieces.map((p) => p.step));
    expect(m.step_names[lastStep]).toMatch(/Storey 2: roof/);
  });

  it("rejects room inputs out of range", () => {
    const bad: Record<string, number>[] = [{ rooms_mode: 9 }, { rooms_mode: -1 }, { room_offices: 99 }, { extinguisher_count: 11 }, { water_cooler_count: 5 }];
    for (const over of bad) {
      expect(layoutPortaCabin({ ...UNIT, ...over }).ok).toBe(false);
    }
  });
});
