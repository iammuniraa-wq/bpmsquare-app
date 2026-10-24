// Builds three.js materials from the catalogue (src/lib/estimator/materialCatalog.ts). One library per
// scene: materials are cached by key (or by colour), textures load lazily from /textures/<key>/ and the
// material shows its flat colour until the texture arrives (or for good if the file is missing), so a
// missing texture never breaks a view. dispose() frees everything the library created.

import * as THREE from "three";
import { getMaterialDef, HEX_COLOUR } from "@/lib/estimator/materialCatalog";

export type MaterialLibrary = {
  /** A material for a catalogue key or a "#rrggbb" colour; an unknown value gives a neutral grey. `repeat_m` overrides the catalogue repeat size. */
  get(value: string, repeat_m?: number): THREE.MeshStandardMaterial;
  dispose(): void;
};

const TEXTURE_BASE = "/textures";

export function createMaterialLibrary(maxAnisotropy = 4): MaterialLibrary {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const textures: THREE.Texture[] = [];
  const loader = new THREE.TextureLoader();

  function load(url: string, colorSpace: string, repeatOver: number, apply: (t: THREE.Texture) => void) {
    loader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = colorSpace as THREE.ColorSpace;
        t.anisotropy = maxAnisotropy;
        t.repeat.set(1 / repeatOver, 1 / repeatOver);
        textures.push(t);
        apply(t);
      },
      undefined,
      () => { /* a missing file leaves the flat colour */ }
    );
  }

  return {
    get(value, repeat_m) {
      const cacheKey = `${value}|${repeat_m ?? ""}`;
      const hit = cache.get(cacheKey);
      if (hit) return hit;
      let mat: THREE.MeshStandardMaterial;
      if (HEX_COLOUR.test(value)) {
        mat = new THREE.MeshStandardMaterial({ color: value, roughness: 0.6, metalness: 0.05 });
      } else {
        const def = getMaterialDef(value);
        if (!def) {
          mat = new THREE.MeshStandardMaterial({ color: "#a0a4a8", roughness: 0.7, metalness: 0 });
        } else {
          mat = new THREE.MeshStandardMaterial({
            color: def.color, roughness: def.roughness, metalness: def.metalness,
            transparent: def.opacity !== undefined && def.opacity < 1, opacity: def.opacity ?? 1,
          });
          if (def.textured) {
            const over = repeat_m ?? def.repeat_m ?? 1;
            const dir = `${TEXTURE_BASE}/${def.key}`;
            load(`${dir}/diffuse.jpg`, THREE.SRGBColorSpace, over, (t) => { mat.map = t; mat.color.set("#ffffff"); mat.needsUpdate = true; });
            load(`${dir}/normal.jpg`, THREE.NoColorSpace, over, (t) => { mat.normalMap = t; mat.needsUpdate = true; });
            load(`${dir}/rough.jpg`, THREE.NoColorSpace, over, (t) => { mat.roughnessMap = t; mat.roughness = 1; mat.needsUpdate = true; });
          }
        }
      }
      cache.set(cacheKey, mat);
      return mat;
    },
    dispose() {
      cache.forEach((m) => m.dispose());
      cache.clear();
      textures.forEach((t) => t.dispose());
      textures.length = 0;
    },
  };
}
