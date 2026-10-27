// A tiny kit for building one piece of furniture or equipment from boxes, cylinders and spheres.
// Every part is added with the material it is drawn in; build() merges the parts of one material into
// a single mesh, so an item costs two to five draw calls however many parts it has. All coordinates are
// local to the item: x across its width, y up, z toward its front, origin at the middle of its box.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const CYL_SEGMENTS = 16;
const SPHERE_SEGMENTS = 12;
const MIN = 0.004;

export class Parts {
  private readonly groups = new Map<THREE.Material, THREE.BufferGeometry[]>();

  private put(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): void {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    geo.applyMatrix4(m);
    const list = this.groups.get(mat);
    if (list) list.push(geo);
    else this.groups.set(mat, [geo]);
  }

  /** A box w x h x t centred at (x, y, z), turned about the vertical axis by `ry`. */
  box(mat: THREE.Material, w: number, h: number, t: number, x: number, y: number, z: number, ry = 0): this {
    this.put(mat, new THREE.BoxGeometry(Math.max(MIN, w), Math.max(MIN, h), Math.max(MIN, t)), x, y, z, 0, ry, 0);
    return this;
  }

  /** A cylinder standing on the y axis, `h` high, with its own top and bottom radius; sx / sz stretch it into an oval. */
  cyl(mat: THREE.Material, rTop: number, rBottom: number, h: number, x: number, y: number, z: number, sx = 1, sz = 1): this {
    this.put(mat, new THREE.CylinderGeometry(Math.max(MIN, rTop), Math.max(MIN, rBottom), Math.max(MIN, h), CYL_SEGMENTS), x, y, z, 0, 0, 0, sx, 1, sz);
    return this;
  }

  /** A cylinder lying along the z axis (a fan, a hose, a pipe to the wall). */
  cylZ(mat: THREE.Material, r: number, len: number, x: number, y: number, z: number): this {
    this.put(mat, new THREE.CylinderGeometry(Math.max(MIN, r), Math.max(MIN, r), Math.max(MIN, len), CYL_SEGMENTS), x, y, z, Math.PI / 2, 0, 0);
    return this;
  }

  sphere(mat: THREE.Material, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): this {
    this.put(mat, new THREE.SphereGeometry(Math.max(MIN, r), SPHERE_SEGMENTS, SPHERE_SEGMENTS - 2), x, y, z, 0, 0, 0, sx, sy, sz);
    return this;
  }

  /** One mesh per material, each marked with the piece's mark so a click picks the piece. */
  build(mark: string, shadows = true): THREE.Group {
    const g = new THREE.Group();
    for (const [mat, geos] of this.groups) {
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (geos.length > 1) geos.forEach((q) => q.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows && !(mat as THREE.MeshStandardMaterial).transparent;
      mesh.receiveShadow = shadows;
      mesh.userData = { mark };
      g.add(mesh);
    }
    this.groups.clear();
    g.userData = { mark };
    return g;
  }
}
