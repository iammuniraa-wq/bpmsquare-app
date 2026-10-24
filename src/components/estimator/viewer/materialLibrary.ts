// Builds three.js materials from the catalogue (src/lib/estimator/materialCatalog.ts). One library per
// scene: materials are cached by key (or by colour), textures load lazily from /textures/<key>/ and the
// material shows its flat colour until the texture arrives (or for good if the file is missing), so a
// missing texture never breaks a view. dispose() frees everything the library created.
//
// Texture repeat is 1 / repeat_m, so geometry must carry UVs in metres (metricGeometry.ts does).

import * as THREE from "three";
import { getMaterialDef, HEX_COLOUR } from "@/lib/estimator/materialCatalog";

export type MaterialLibrary = {
  /** A material for a catalogue key or a "#rrggbb" colour; an unknown value gives a neutral grey. `repeat_m` overrides the catalogue repeat size. */
  get(value: string, repeat_m?: number): THREE.MeshStandardMaterial;
  dispose(): void;
};

const TEXTURE_BASE = "/textures";

/** The three maps a textured material may carry, and how each is read. */
export const TEXTURE_MAPS = [
  { file: "diffuse.jpg", slot: "map", sRGB: true },
  { file: "normal.jpg", slot: "normalMap", sRGB: false },
  { file: "rough.jpg", slot: "roughnessMap", sRGB: false },
] as const;

/**
 * `onChange` fires whenever a texture finishes loading so an on-demand renderer can draw a new frame.
 * A texture that fails to load (missing file) is simply left out.
 */
export function createMaterialLibrary(maxAnisotropy = 4, onChange?: () => void): MaterialLibrary {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const textures: THREE.Texture[] = [];
  const loader = new THREE.TextureLoader();
  let disposed = false;

  function load(url: string, sRGB: boolean, repeatOver: number, apply: (t: THREE.Texture) => void) {
    loader.load(
      url,
      (t) => {
        if (disposed) { t.dispose(); return; }
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = sRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = maxAnisotropy;
        t.repeat.set(1 / repeatOver, 1 / repeatOver);
        textures.push(t);
        apply(t);
        onChange?.();
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
          const see = def.opacity !== undefined && def.opacity < 1;
          mat = new THREE.MeshStandardMaterial({
            color: def.color, roughness: def.roughness, metalness: def.metalness,
            transparent: see, opacity: def.opacity ?? 1,
            // Glass reflects the sky, and must not hide what is behind it from the depth buffer.
            ...(see ? { depthWrite: false, envMapIntensity: 1.6 } : {}),
          });
          if (def.textured) {
            const over = repeat_m ?? def.repeat_m ?? 1;
            const dir = `${TEXTURE_BASE}/${def.key}`;
            for (const m of TEXTURE_MAPS) {
              if (m.slot === "normalMap" && def.no_normal) continue;
              load(`${dir}/${m.file}`, m.sRGB, over, (t) => {
                if (m.slot === "map") { mat.map = t; mat.color.set(def.tint ?? "#ffffff"); }
                else if (m.slot === "normalMap") mat.normalMap = t;
                else { mat.roughnessMap = t; mat.roughness = 1; }
                mat.needsUpdate = true;
              });
            }
          }
        }
      }
      cache.set(cacheKey, mat);
      return mat;
    },
    dispose() {
      disposed = true;
      cache.forEach((m) => m.dispose());
      cache.clear();
      textures.forEach((t) => t.dispose());
      textures.length = 0;
    },
  };
}
