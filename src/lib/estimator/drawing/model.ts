// The small internal model of a DXF drawing (drawing intake, docs/design/drawing-intake.md part 2). Plain data, no
// dependencies: the server builds it from dxf-parser's output (dxf.ts), and the browser viewer and the measuring
// code read it, so it must stay JSON-safe and compact.

export type Pt = [number, number];

export type DxfEntity =
  | { t: "line"; layer: string; a: Pt; b: Pt }
  /** `bulge` is true when the source had arc segments; they are drawn and measured as straight chords. */
  | { t: "poly"; layer: string; pts: Pt[]; closed: boolean; bulge?: true }
  /** Counter-clockwise from `a0` to `a1`, degrees. */
  | { t: "arc"; layer: string; c: Pt; r: number; a0: number; a1: number }
  | { t: "circle"; layer: string; c: Pt; r: number }
  /** `sx` / `sy` scale, `rot` degrees; `cols` / `rows` > 1 for an array insert. */
  | { t: "insert"; layer: string; name: string; at: Pt; sx: number; sy: number; rot: number; cols?: number; rows?: number }
  | { t: "text"; layer: string; at: Pt; text: string; h: number };

export type DxfLayer = {
  name: string;
  /** Neutral drawing colour as #rrggbb, from the drawing's own layer table. */
  color: string;
  /** Off or frozen in the drawing (the viewer starts it hidden). */
  hidden: boolean;
};

export type DxfUnit = {
  /** $INSUNITS code (0 = unitless / not stated). */
  code: number;
  name: string;
  /** Metres per drawing unit, or null when the drawing does not say (the person is asked). */
  factor: number | null;
};

export type Extents = { minX: number; minY: number; maxX: number; maxY: number };

export type DxfModel = {
  layers: DxfLayer[];
  entities: DxfEntity[];
  /** Entities of the blocks that are inserted, by block name, so the viewer can draw an insert's contents. Never measured. */
  blocks: Record<string, DxfEntity[]>;
  unit: DxfUnit;
  extents: Extents | null;
  warnings: string[];
  /** How many entities the file had in total (the model keeps all that it understands). */
  entityCount: number;
  /** Entity kinds the reader skipped (splines, hatches, dimensions...), by DXF name. */
  skipped: Record<string, number>;
};

export const MAX_DXF_BYTES = 15 * 1024 * 1024;
export const MAX_DXF_ENTITIES = 200_000;
/** The viewer draws at most this many primitives (the rest is counted and said). */
export const MAX_DRAWN = 50_000;
