// The exact building model (docs/estimator-architecture.md §10.1, §10.2).
//
// A geometry module turns a template's input values into a list of real
// PIECES -- every wall panel, plank, beam, column, stair flight and
// boundary-wall panel, each with a mark, size, position, erection step and
// concrete volume. The 3D viewer draws exactly these pieces and the BOM is
// summed from exactly these pieces, so what is on screen is what is priced.
// Pure data and types: no I/O, safe to import from client components.

export type Vec3 = [number, number, number];

/** A window or door cut into a panel. Metres, sill measured from the floor. */
export type PieceOpening = { w: number; h: number; sill: number; door: boolean };

export type PieceKind = "col" | "box" | "panel" | "plank" | "stair";

export type Piece = {
  /** The mark: the code plus a running number, e.g. EW-07. Unique per model. */
  id: string;
  /** The piece family (EW, SL, ...); what vol_<code>, n_<code> and area_<code> sum over. */
  code: string;
  kind: PieceKind;
  /** Erection step, 1-based, indexes GeometryModel.step_names (index 0 is the foundation). */
  step: number;
  /** Zero-based storey the piece belongs to. */
  floor: number;
  /** Centre of the piece, metres: [x, height above ground, z]. */
  pos: Vec3;
  /** Rotation about the vertical axis, radians (0 or PI / 2). */
  rot?: number;
  /** Bounding size, metres: w across, h high, t thick (for a plank or stair t is its run). */
  dims: { w: number; h: number; t: number };
  op?: PieceOpening | null;
  /** Concrete volume, m3 (openings and hollow cores already deducted). */
  vol: number;
  /** Net face area, m2, on pieces where it matters (external panels). */
  area?: number;
};

export type GeometryModel = {
  /** Key of the module that produced it (also stored on the template). */
  geometry: string;
  pieces: Piece[];
  /** Footprint of the building, metres. */
  w: number;
  d: number;
  /** Name of each erection step; step_names[0] is the foundation. */
  step_names: string[];
  /** Things the module adjusted or assumed (clamped inputs, fallback footprint). */
  warnings: string[];
};

export type GeometryResult = { ok: true; model: GeometryModel } | { ok: false; error: string };

export type GeometryInputSpec = {
  key: string;
  /** A template that names this module must define the input. */
  required: boolean;
  /** Value used when the template does not define an optional input. */
  default?: number;
};

export type PieceCodeInfo = { code: string; label: string };

export type GeometryModule = {
  key: string;
  label: string;
  /** Piece families the module can emit; each one exposes vol_/n_/area_ identifiers. */
  piece_codes: readonly PieceCodeInfo[];
  inputs: readonly GeometryInputSpec[];
  /** Pure: same inputs, same pieces. Never throws; failure is a returned error. */
  layout(inputs: Readonly<Record<string, number>>): GeometryResult;
};

/** Per-family totals the formula engine reads. */
export type PieceFamilyTotals = { n: number; vol: number; area: number; first_mark: string | null; last_mark: string | null };
