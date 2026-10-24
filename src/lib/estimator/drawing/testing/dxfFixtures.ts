// Hand-written DXF text for the drawing tests. A test helper only: nothing outside *.test.ts imports it.

const g = (code: number, value: string | number) => `${String(code).padStart(3, " ")}\n${value}`;

export const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
  [g(0, "LINE"), g(8, layer), g(10, x1), g(20, y1), g(30, 0), g(11, x2), g(21, y2), g(31, 0)].join("\n");

export const lwpoly = (layer: string, pts: [number, number, number?][], closed = false) =>
  [g(0, "LWPOLYLINE"), g(8, layer), g(90, pts.length), g(70, closed ? 1 : 0), ...pts.flatMap(([x, y, b]) => [g(10, x), g(20, y), ...(b ? [g(42, b)] : [])])].join("\n");

export const circle = (layer: string, x: number, y: number, r: number) =>
  [g(0, "CIRCLE"), g(8, layer), g(10, x), g(20, y), g(30, 0), g(40, r)].join("\n");

export const arc = (layer: string, x: number, y: number, r: number, a0: number, a1: number) =>
  [g(0, "ARC"), g(8, layer), g(10, x), g(20, y), g(30, 0), g(40, r), g(50, a0), g(51, a1)].join("\n");

export const insert = (layer: string, name: string, x: number, y: number, extra: { sx?: number; rot?: number; cols?: number; rows?: number } = {}) =>
  [g(0, "INSERT"), g(8, layer), g(2, name), g(10, x), g(20, y), g(30, 0),
    ...(extra.sx ? [g(41, extra.sx), g(42, extra.sx)] : []), ...(extra.rot ? [g(50, extra.rot)] : []),
    ...(extra.cols ? [g(70, extra.cols)] : []), ...(extra.rows ? [g(71, extra.rows)] : [])].join("\n");

export const text = (layer: string, x: number, y: number, h: number, value: string) =>
  [g(0, "TEXT"), g(8, layer), g(10, x), g(20, y), g(30, 0), g(40, h), g(1, value)].join("\n");

export const mtext = (layer: string, x: number, y: number, h: number, value: string) =>
  [g(0, "MTEXT"), g(8, layer), g(10, x), g(20, y), g(30, 0), g(40, h), g(1, value)].join("\n");

export const spline = (layer: string) => [g(0, "SPLINE"), g(8, layer), g(70, 8)].join("\n");

export type DxfLayerDef = { name: string; colorIndex?: number; frozen?: boolean };

/** A complete DXF file. `units` is the $INSUNITS code (omit for a drawing that does not say). */
export function dxfFile(opts: { units?: number; layers?: DxfLayerDef[]; entities: string[]; blocks?: Record<string, string[]> }): string {
  const header = [g(0, "SECTION"), g(2, "HEADER"), ...(opts.units !== undefined ? [g(9, "$INSUNITS"), g(70, opts.units)] : []), g(0, "ENDSEC")];
  const tables = opts.layers
    ? [g(0, "SECTION"), g(2, "TABLES"), g(0, "TABLE"), g(2, "LAYER"), g(70, opts.layers.length),
      ...opts.layers.flatMap((l) => [g(0, "LAYER"), g(2, l.name), g(70, l.frozen ? 1 : 0), g(62, l.colorIndex ?? 7), g(6, "CONTINUOUS")]),
      g(0, "ENDTAB"), g(0, "ENDSEC")]
    : [];
  const blocks = opts.blocks
    ? [g(0, "SECTION"), g(2, "BLOCKS"),
      ...Object.entries(opts.blocks).flatMap(([name, ents]) => [g(0, "BLOCK"), g(8, "0"), g(2, name), g(70, 0), g(10, 0), g(20, 0), g(30, 0), ...ents, g(0, "ENDBLK"), g(8, "0")]),
      g(0, "ENDSEC")]
    : [];
  return [...header, ...tables, ...blocks, g(0, "SECTION"), g(2, "ENTITIES"), ...opts.entities, g(0, "ENDSEC"), g(0, "EOF")].join("\n") + "\n";
}

/** A rectangle as four lines. */
export const rectLines = (layer: string, w: number, h: number) => [
  line(layer, 0, 0, w, 0), line(layer, w, 0, w, h), line(layer, w, h, 0, h), line(layer, 0, h, 0, 0),
];
