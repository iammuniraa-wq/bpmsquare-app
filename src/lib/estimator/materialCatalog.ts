// The materials a 3D estimate can be painted with. Pure data (no three.js), so the template editor,
// the starter templates and the viewer all read one list. A textured material points at a CC0 texture
// set stored under public/textures/<key>/ (diffuse.jpg, normal.jpg, optional rough.jpg); a plain
// material is just a colour with roughness / metalness. Texture sets come from Poly Haven / ambientCG
// (both CC0); public/textures/CREDITS.md records each source id.

export type MaterialGroup = "concrete" | "metal" | "tile" | "wood" | "cladding" | "glass" | "ground" | "paint";

export type MaterialDef = {
  key: string;
  label: string;
  group: MaterialGroup;
  /** Colour used for a plain material, and as the tint / fallback while a texture loads. */
  color: string;
  roughness: number;
  metalness: number;
  /** True when public/textures/<key>/ holds a texture set. */
  textured?: boolean;
  /** Size in metres one texture repeat covers on the model (a 0.6 m tile texture = 0.6). */
  repeat_m?: number;
  /** 0..1, glass and mesh. */
  opacity?: number;
  /** Poly Haven / ambientCG id the set was taken from (for CREDITS). */
  source?: string;
};

export const MATERIALS: readonly MaterialDef[] = [
  // concrete
  { key: "concrete_precast", label: "Precast concrete", group: "concrete", color: "#c4c6c8", roughness: 0.92, metalness: 0, textured: true, repeat_m: 2, source: "polyhaven:concrete_wall_008" },
  { key: "concrete_smooth", label: "Smooth concrete", group: "concrete", color: "#b9bcbf", roughness: 0.8, metalness: 0 },
  // metal and fence
  { key: "galvanised", label: "Galvanised steel", group: "metal", color: "#aeb6bd", roughness: 0.45, metalness: 0.85 },
  { key: "pvc_green", label: "Green PVC coating", group: "metal", color: "#2f6b45", roughness: 0.55, metalness: 0.1 },
  { key: "pvc_black", label: "Black PVC coating", group: "metal", color: "#222426", roughness: 0.55, metalness: 0.1 },
  { key: "pvc_blue", label: "Blue PVC coating", group: "metal", color: "#25508a", roughness: 0.55, metalness: 0.1 },
  // tile
  { key: "porcelain_white", label: "White porcelain", group: "tile", color: "#eeeeea", roughness: 0.22, metalness: 0, textured: true, repeat_m: 0.6, source: "polyhaven:large_floor_tiles_02" },
  { key: "porcelain_grey", label: "Grey porcelain", group: "tile", color: "#9a9ea2", roughness: 0.3, metalness: 0, textured: true, repeat_m: 0.6, source: "polyhaven:concrete_tiles_02" },
  { key: "marble_white", label: "White marble", group: "tile", color: "#efeeee", roughness: 0.15, metalness: 0, textured: true, repeat_m: 1.2, source: "polyhaven:marble_01" },
  { key: "terrazzo", label: "Terrazzo", group: "tile", color: "#d8d2c8", roughness: 0.28, metalness: 0, textured: true, repeat_m: 0.9, source: "ambientcg:Terrazzo" },
  { key: "ceramic_beige", label: "Beige ceramic", group: "tile", color: "#d9c9a8", roughness: 0.4, metalness: 0, textured: true, repeat_m: 0.45, source: "polyhaven:beige_wall_001" },
  // wood
  { key: "wood_oak", label: "Oak plank", group: "wood", color: "#b58a5a", roughness: 0.55, metalness: 0, textured: true, repeat_m: 1.2, source: "polyhaven:wood_floor_deck" },
  { key: "wood_door", label: "Timber door", group: "wood", color: "#7a5c3e", roughness: 0.6, metalness: 0 },
  // cladding (cabins)
  { key: "cladding_white", label: "White sandwich panel", group: "cladding", color: "#e8eaec", roughness: 0.5, metalness: 0.05 },
  { key: "cladding_grey", label: "Grey sandwich panel", group: "cladding", color: "#8e9399", roughness: 0.5, metalness: 0.05 },
  { key: "cladding_sand", label: "Sand sandwich panel", group: "cladding", color: "#cdbb98", roughness: 0.5, metalness: 0.05 },
  { key: "cladding_blue", label: "Blue sandwich panel", group: "cladding", color: "#4a6f9c", roughness: 0.5, metalness: 0.05 },
  { key: "roof_sheet", label: "Profiled roof sheet", group: "cladding", color: "#9aa0a6", roughness: 0.5, metalness: 0.6, textured: true, repeat_m: 1, source: "polyhaven:corrugated_iron" },
  // glass
  { key: "glass", label: "Glass", group: "glass", color: "#b9dbe6", roughness: 0.05, metalness: 0, opacity: 0.45 },
  // ground
  { key: "ground_grass", label: "Grass", group: "ground", color: "#6f8f4a", roughness: 1, metalness: 0, textured: true, repeat_m: 3, source: "polyhaven:aerial_grass_rock" },
  { key: "ground_paving", label: "Paving", group: "ground", color: "#b8b2a6", roughness: 0.9, metalness: 0, textured: true, repeat_m: 2, source: "polyhaven:concrete_pavement_02" },
  { key: "ground_sand", label: "Sand", group: "ground", color: "#d6cdbf", roughness: 1, metalness: 0, textured: true, repeat_m: 3, source: "polyhaven:brown_mud_leaves_01" },
];

const BY_KEY: Readonly<Record<string, MaterialDef>> = Object.fromEntries(MATERIALS.map((m) => [m.key, m]));

export function getMaterialDef(key: string): MaterialDef | null {
  return Object.prototype.hasOwnProperty.call(BY_KEY, key) ? BY_KEY[key] : null;
}

export const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/** True for a material key in the catalogue or a plain "#rrggbb" colour. */
export function isVisualValue(v: unknown): v is string {
  return typeof v === "string" && (HEX_COLOUR.test(v) || getMaterialDef(v) !== null);
}

export function materialsInGroup(group: MaterialGroup): MaterialDef[] {
  return MATERIALS.filter((m) => m.group === group);
}
