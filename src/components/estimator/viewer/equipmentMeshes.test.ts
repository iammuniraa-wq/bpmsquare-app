import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildEquipment } from "./equipmentMeshes";
import { SHAPES } from "./equipmentShapes";
import { createMaterialLibrary } from "./materialLibrary";
import { CABIN_EQUIPMENT } from "@/lib/estimator/geometry/cabinEquipment";
import { layoutPortaCabin } from "@/lib/estimator/geometry/portaCabin";
import type { Piece } from "@/lib/estimator/geometry";

const pieceOf = (item: string, over: Partial<Piece> = {}): Piece => {
  const it = CABIN_EQUIPMENT.find((i) => i.key === item)!;
  return { id: "EQ-01", code: "EQ", kind: "equip", step: 1, floor: 0, pos: [1, 0.5, -2], rot: 0, dims: { w: it.w, h: it.h, t: it.t }, vol: 0, item, room: "office-1", slot: "equipment", ...over };
};
const meshesOf = (g: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  g.traverse((n) => { if ((n as THREE.Mesh).isMesh) out.push(n as THREE.Mesh); });
  return out;
};

describe("equipment meshes", () => {
  const lib = createMaterialLibrary();

  it("draws every catalogue item", () => {
    for (const i of CABIN_EQUIPMENT) expect(SHAPES[i.key], i.key).toBeTypeOf("function");
  });

  it.each(CABIN_EQUIPMENT.map((i) => [i.key]))("%s is a few merged meshes, all marked for picking, close to its size", (key) => {
    const p = pieceOf(key, { id: "EQ-07" });
    const g = buildEquipment(p, lib);
    const meshes = meshesOf(g);
    expect(meshes.length).toBeGreaterThanOrEqual(1);
    expect(meshes.length).toBeLessThanOrEqual(6);
    for (const m of meshes) expect(m.userData.mark).toBe("EQ-07");
    expect(g.userData.mark).toBe("EQ-07");
    // positioned and turned like the piece
    expect(g.position.toArray()).toEqual([1, 0.5, -2]);
    expect(g.rotation.y).toBe(0);
    // sized like the piece: a monitor or a ladder may stand a little proud, nothing is far off
    g.position.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(p.dims.w * 0.5);
    expect(size.x).toBeLessThan(p.dims.w + 0.2);
    expect(size.z).toBeLessThan(p.dims.t + 0.2);
    expect(size.y).toBeGreaterThan(p.dims.h * 0.5);
    expect(size.y).toBeLessThan(p.dims.h + 0.45);
    // light: a few thousand triangles at most
    const tris = meshes.reduce((a, m) => a + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
    expect(tris).toBeLessThan(2500);
  });

  it("turns with the piece's rotation", () => {
    const g = buildEquipment(pieceOf("desk", { rot: Math.PI / 2 }), lib);
    expect(g.rotation.y).toBeCloseTo(Math.PI / 2, 6);
  });

  it("an air conditioner's body takes the item's own colour, or the design attribute's paint", () => {
    const own = meshesOf(buildEquipment(pieceOf("ac_split"), lib)).map((m) => m.material);
    const painted = meshesOf(buildEquipment(pieceOf("ac_split"), lib, "#336699")).map((m) => (m.material as THREE.MeshStandardMaterial).color.getHexString());
    expect(own).toContain(lib.get("#f2f3f4"));
    expect(painted).toContain("336699");
  });

  it("an item the catalogue does not know is drawn as a plain box of the piece's size", () => {
    const g = buildEquipment(pieceOf("desk", { item: "hologram_table" }), lib);
    const meshes = meshesOf(g);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].userData.mark).toBe("EQ-01");
  });

  it("builds every piece of a furnished cabin without error, with unique marks", () => {
    const r = layoutPortaCabin({ unit_length_m: 6, unit_width_m: 2.4, unit_height_m: 2.6, units_along: 3, layout: 2, door_count: 2, window_count: 4, rooms_mode: 1 });
    if (!r.ok) throw new Error(r.error);
    const eq = r.model.pieces.filter((p) => p.kind === "equip");
    expect(eq.length).toBeGreaterThan(40);
    const marks = new Set<string>();
    let meshCount = 0;
    for (const p of eq) {
      const ms = meshesOf(buildEquipment(p, lib));
      expect(ms.length).toBeGreaterThan(0);
      meshCount += ms.length;
      marks.add(ms[0].userData.mark);
    }
    expect(marks.size).toBe(eq.length);
    // a few meshes an item, not a mesh for every board
    expect(meshCount / eq.length).toBeLessThan(5);
  });
});
