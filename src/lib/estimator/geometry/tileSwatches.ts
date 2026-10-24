// Tile colour swatches for the 2D floor preview. There is no image loader: a
// tile is a colour (three close tones, so a floor reads as real tiles rather
// than a flat fill) plus an optional procedural texture. The option numbers
// are what the `tile_color` select input sends to the geometry module, so a
// template's options must use these values. The colours are product data, not
// theme tokens (a terracotta tile is terracotta in dark mode too).

export type TileTexture = "plain" | "speckle" | "veined" | "wood";

export type TileSwatch = {
  /** The number the tile_color select sends (1-based). */
  value: number;
  key: string;
  name: string;
  /** Three close tones; a tile takes one of them by position. */
  tones: readonly [string, string, string];
  grout: string;
  texture: TileTexture;
  /** Texture strokes / dots. */
  mark: string;
};

export const TILE_SWATCHES: readonly TileSwatch[] = [
  { value: 1, key: "ivory", name: "Ivory", tones: ["#ebe4d3", "#e4dcc8", "#efe9db"], grout: "#b9b2a2", texture: "plain", mark: "#cfc6b0" },
  { value: 2, key: "warm_grey", name: "Warm grey", tones: ["#bdb9b2", "#b3afa8", "#c6c2bb"], grout: "#8c8880", texture: "speckle", mark: "#9d9992" },
  { value: 3, key: "charcoal", name: "Charcoal", tones: ["#4d5157", "#464a50", "#555a60"], grout: "#2b2e32", texture: "speckle", mark: "#6a6f76" },
  { value: 4, key: "terracotta", name: "Terracotta", tones: ["#b9643f", "#ad5b38", "#c26d47"], grout: "#7a4a35", texture: "plain", mark: "#9a4f31" },
  { value: 5, key: "sandstone", name: "Sandstone", tones: ["#d6bd90", "#cdb284", "#ddc59b"], grout: "#a28d68", texture: "speckle", mark: "#b79f74" },
  { value: 6, key: "marble", name: "Marble white", tones: ["#f2f2ef", "#eaeae6", "#f6f6f3"], grout: "#b7b8b5", texture: "veined", mark: "#b8bcc2" },
  { value: 7, key: "oak", name: "Oak wood look", tones: ["#b48a58", "#a97f4f", "#bd9563"], grout: "#7d5d3a", texture: "wood", mark: "#8f6a40" },
];

export const DEFAULT_TILE_SWATCH = TILE_SWATCHES[0];

/** The swatch for a tile_color number; an unknown number gives the default. */
export function swatchFor(value: number | undefined): TileSwatch {
  return TILE_SWATCHES.find((s) => s.value === value) ?? DEFAULT_TILE_SWATCH;
}

/** The options a template's `tile_color` select input should carry. */
export const TILE_COLOR_OPTIONS: readonly { key: string; label: string; value: number }[] = TILE_SWATCHES.map((s) => ({
  key: s.key, label: s.name, value: s.value,
}));
