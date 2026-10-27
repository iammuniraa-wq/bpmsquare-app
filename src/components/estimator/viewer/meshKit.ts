// The small toolkit pieceMeshes.ts and fenceMeshes.ts share: a build context (material library, a geometry
// cache so repeated parts share one buffer, the diamond-mesh texture) and addPart(), which adds one mesh to a
// piece's group with the metadata the scene paints from (userData.mark, .slot, .def, .noTint, .decor).

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { GeometryModel } from "@/lib/estimator/geometry";
import { DIAMOND_TILE_PX } from "@/lib/estimator/geometry/chainlinkFenceDraw";
import type { MaterialLibrary } from "./materialLibrary";

/** Extra surface treatment a part needs on top of its slot's material (the chain-link mesh is an alpha-cut diamond lattice). */
export type PartDecor = { id: string; alphaMap: THREE.Texture; alphaTest: number };

/** Models with more pieces than this skip the small details (caps, footings, handles) to keep a phone smooth. */
export const DETAIL_PIECE_LIMIT = 700;

export type BuildCtx = {
  lib: MaterialLibrary;
  model: GeometryModel;
  detail: boolean;
  /** Shared geometries, freed by disposeBuildCtx. */
  geo: Map<string, THREE.BufferGeometry>;
  /** Anything a builder wants computed once per model (fence runs, ...). */
  memo: Map<string, unknown>;
  edge: THREE.LineBasicMaterial | null;
  diamond: THREE.CanvasTexture | null;
  /** Highest floor that has hollow-core planks: that slab is the roof. */
  roofFloor: number;
};

export function createBuildCtx(lib: MaterialLibrary, model: GeometryModel): BuildCtx {
  let roofFloor = -1;
  for (const p of model.pieces) if (p.kind === "plank" && p.floor > roofFloor) roofFloor = p.floor;
  return { lib, model, detail: model.pieces.length <= DETAIL_PIECE_LIMIT, geo: new Map(), memo: new Map(), edge: null, diamond: null, roofFloor };
}

export function disposeBuildCtx(ctx: BuildCtx): void {
  ctx.geo.forEach((g) => g.dispose());
  ctx.geo.clear();
  ctx.memo.clear();
  ctx.edge?.dispose();
  ctx.edge = null;
  ctx.diamond?.dispose();
  ctx.diamond = null;
}

/** A geometry shared by every part that asks for the same key. */
export function sharedGeo<T extends THREE.BufferGeometry>(ctx: BuildCtx, key: string, make: () => T): T {
  const hit = ctx.geo.get(key);
  if (hit) return hit as T;
  const g = make();
  ctx.geo.set(key, g);
  return g;
}

const q = (n: number) => Math.round(n * 1000) / 1000;

export function boxGeo(ctx: BuildCtx, w: number, h: number, t: number): THREE.BoxGeometry {
  const a = Math.max(0.005, q(w));
  const b = Math.max(0.005, q(h));
  const c = Math.max(0.005, q(t));
  return sharedGeo(ctx, `box:${a}:${b}:${c}`, () => new THREE.BoxGeometry(a, b, c));
}

/** The faint outline that marks a panel's edges (joint lines). One material for the whole model. */
export function edgeMaterial(ctx: BuildCtx, colour: string): THREE.LineBasicMaterial {
  if (!ctx.edge) ctx.edge = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.28, fog: true });
  return ctx.edge;
}

/** One tile of the diamond mesh: a white X on black (an alphaMap reads the green channel), tiled by the UVs. */
export function diamondTexture(ctx: BuildCtx): THREE.CanvasTexture {
  if (ctx.diamond) return ctx.diamond;
  const s = DIAMOND_TILE_PX;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = s;
  const c = canvas.getContext("2d");
  if (c) {
    c.fillStyle = "#000";
    c.fillRect(0, 0, s, s);
    c.strokeStyle = "#fff";
    c.lineWidth = s * 0.1;
    c.lineCap = "butt";
    c.beginPath();
    c.moveTo(-2, -2); c.lineTo(s + 2, s + 2);
    c.moveTo(s + 2, -2); c.lineTo(-2, s + 2);
    c.stroke();
  }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  ctx.diamond = t;
  return t;
}

/**
 * Fold a piece's parts that share one material treatment into a single mesh (a window panel is a handful of
 * draw calls instead of twenty). Geometry is baked into the piece's own space; the mark, slot and shadow flags
 * carry over, and a part flagged `edges` gets its outline drawn on the merged mesh.
 */
export function mergeGroupParts(g: THREE.Group, ctx: BuildCtx): void {
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const c of g.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh || !m.geometry.index) continue;
    const u = m.userData as { slot?: string | null; def?: string; noTint?: boolean; decor?: PartDecor | null };
    if (u.def === undefined) continue;
    const key = [u.slot ?? "", u.def, u.noTint ? 1 : 0, u.decor?.id ?? "", m.castShadow ? 1 : 0, m.receiveShadow ? 1 : 0, m.renderOrder].join("|");
    const list = buckets.get(key);
    if (list) list.push(m); else buckets.set(key, [m]);
  }
  const outline = (mesh: THREE.Mesh) => {
    if (!ctx.detail || !mesh.userData.edges) return;
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), edgeMaterial(ctx, EDGE_COLOUR));
    lines.raycast = () => {};
    mesh.add(lines);
  };
  for (const list of buckets.values()) {
    if (list.length < 2) { outline(list[0]); continue; }
    const baked = list.map((m) => {
      const geo = m.geometry.clone();
      m.updateMatrix();
      geo.applyMatrix4(m.matrix);
      return geo;
    });
    const merged = mergeGeometries(baked);
    baked.forEach((b) => b.dispose());
    if (!merged) continue;
    const first = list[0];
    const mesh = new THREE.Mesh(merged, first.material);
    mesh.castShadow = first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.renderOrder = first.renderOrder;
    mesh.userData = { ...first.userData, edges: list.some((m) => m.userData.edges), own: true };
    for (const m of list) {
      g.remove(m);
      if (m.userData.own) m.geometry.dispose();
    }
    outline(mesh);
    g.add(mesh);
  }
}

export const EDGE_COLOUR = "#6f7a86";

export type PartOpts = {
  mark: string;
  /** The design slot this part is painted by; null = never repainted (it keeps `def`). */
  slot: string | null;
  /** Material key or "#rrggbb" used when the slot has no choice and the module declares no default for it. */
  def: string;
  pos?: readonly [number, number, number];
  rot?: readonly [number, number, number];
  /** Glass and the like: the step / family colouring is not applied. */
  noTint?: boolean;
  cast?: boolean;
  receive?: boolean;
  decor?: PartDecor;
  order?: number;
  /** The geometry belongs to this part alone (not from sharedGeo): freed when parts are merged. */
  own?: boolean;
  /** Draw the part's outline (panel joint lines). */
  edges?: boolean;
};

export function addPart(group: THREE.Group, ctx: BuildCtx, geo: THREE.BufferGeometry, o: PartOpts): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, ctx.lib.get(o.def));
  if (o.pos) mesh.position.set(o.pos[0], o.pos[1], o.pos[2]);
  if (o.rot) mesh.rotation.set(o.rot[0], o.rot[1], o.rot[2]);
  mesh.castShadow = o.cast ?? true;
  mesh.receiveShadow = o.receive ?? true;
  if (o.order !== undefined) mesh.renderOrder = o.order;
  mesh.userData = { mark: o.mark, slot: o.slot, def: o.def, noTint: !!o.noTint, decor: o.decor ?? null, own: !!o.own, edges: !!o.edges };
  group.add(mesh);
  return mesh;
}
