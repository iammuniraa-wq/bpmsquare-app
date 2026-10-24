// Geometry whose UVs are measured in metres, so a texture's repeat (1 / repeat_m, see materialLibrary.ts) lays
// at its real size on every face whatever the size of the piece. A per-piece seed shifts the pattern so two
// neighbouring panels of the same material do not show the same patch.

import * as THREE from "three";

/** A stable 0..1 number from a string (a piece mark), FNV-1a. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** The (u, v) extent in metres of each BoxGeometry face, in its own face order: +x, -x, +y, -y, +z, -z. */
export function boxFaceExtents(w: number, h: number, t: number): [number, number][] {
  return [[t, h], [t, h], [w, t], [w, t], [w, h], [w, h]];
}

export function metricBoxGeometry(w: number, h: number, t: number, seed = 0): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, t);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  const ext = boxFaceExtents(w, h, t);
  const ox = seed * 13.7;
  const oy = seed * 9.3;
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * ext[f][0] + ox, uv.getY(i) * ext[f][1] + oy);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** A horizontal disc (facing up) whose UVs are metres, for a ground that fades into the fog. */
export function metricGroundGeometry(radius: number): THREE.CircleGeometry {
  const g = new THREE.CircleGeometry(radius, 56);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
  uv.needsUpdate = true;
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A plane whose UV step is `pitchU` / `pitchV` metres per repeat (1 / 1 gives metres). */
export function metricPlaneGeometry(w: number, h: number, pitchU = 1, pitchV = 1): THREE.PlaneGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / pitchU, (uv.getY(i) * h) / pitchV);
  uv.needsUpdate = true;
  return g;
}
