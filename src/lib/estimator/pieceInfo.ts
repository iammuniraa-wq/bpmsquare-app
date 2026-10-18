// What the 3D viewer's inspector and the BOM highlight need to know about
// pieces (docs/estimator-architecture.md §10.1). Pure: no three.js, no DOM, so
// it is unit-tested and the same numbers can be reused anywhere.
//
// A BOM line's `element_ref` is a list of mark ranges ("EW-01..EW-40, PR-01..PR-12"
// or a single mark "FR-03"); a piece is covered when its family code matches
// and its running number falls inside a range.

import type { Piece } from "./geometry";

export type MarkRange = { code: string; from: number; to: number };

const MARK_RE = /^([A-Z0-9]+)-(\d+)$/;

/** "EW-01..EW-40, PR-03" -> ranges. Anything that is not a mark is skipped. */
export function parseMarkRanges(ref: string | null | undefined): MarkRange[] {
  if (!ref) return [];
  const out: MarkRange[] = [];
  for (const part of ref.split(",")) {
    const [a, b] = part.trim().split("..").map((x) => x.trim());
    const ma = a ? MARK_RE.exec(a) : null;
    if (!ma) continue;
    const mb = b ? MARK_RE.exec(b) : ma;
    if (!mb || mb[1] !== ma[1]) continue;
    const from = Number(ma[2]);
    const to = Number(mb[2]);
    out.push({ code: ma[1], from: Math.min(from, to), to: Math.max(from, to) });
  }
  return out;
}

export function pieceNumber(piece: Pick<Piece, "id">): number {
  const m = MARK_RE.exec(piece.id);
  return m ? Number(m[2]) : Number.NaN;
}

export function rangesCover(ranges: readonly MarkRange[], piece: Pick<Piece, "id" | "code">): boolean {
  const n = pieceNumber(piece);
  return ranges.some((r) => r.code === piece.code && n >= r.from && n <= r.to);
}

/** The marks of every piece a BOM line's element_ref covers. */
export function marksForRef(ref: string | null | undefined, pieces: readonly Pick<Piece, "id" | "code">[]): string[] {
  const ranges = parseMarkRanges(ref);
  if (ranges.length === 0) return [];
  return pieces.filter((p) => rangesCover(ranges, p)).map((p) => p.id);
}

/** Size as it reads on a drawing: length x height x thickness (a plank or stair: run x width x depth). */
export function pieceSizeLabel(piece: Pick<Piece, "kind" | "dims">, dp = 2): string {
  const { w, h, t } = piece.dims;
  const f = (n: number) => n.toFixed(dp);
  return piece.kind === "plank" || piece.kind === "stair" ? `${f(t)} × ${f(w)} × ${f(h)}` : `${f(w)} × ${f(h)} × ${f(t)}`;
}

export const pieceWeightT = (piece: Pick<Piece, "vol">, densityTm3: number): number => piece.vol * densityTm3;

/** The line fields cost allocation needs; estimate_lines rows fit. */
export type AllocLine = {
  code: string | null;
  description: string;
  uom: string | null;
  element_ref: string | null;
  cost_total: number | null;
};

export type PieceCost = {
  /** Cost allocated to this piece, from its family's lines and the shared lines. */
  cost: number;
  /** The same as a share of the estimate's cost (0 to 1). */
  share: number;
  /** The BOM line that prices this piece's family most directly (largest cost), if any. */
  line: AllocLine | null;
};

/**
 * Splits the estimate's cost over its pieces. A line whose element_ref covers
 * the piece's family is shared among that family's pieces by volume (by face
 * area for a line measured in m2, such as insulation); a line without marks
 * (rebar, moulds, labour, transport, erection, overhead, manual lines) is
 * shared among ALL pieces by volume. So the allocated costs add up to the
 * estimate's cost whenever the pieces have volume.
 */
export function buildCostAllocator(
  pieces: readonly Pick<Piece, "id" | "code" | "vol" | "area">[],
  lines: readonly AllocLine[]
): (piece: Pick<Piece, "id" | "code" | "vol" | "area">) => PieceCost {
  const costed = lines.filter((l) => l.cost_total !== null && Number.isFinite(l.cost_total));
  const totalCost = costed.reduce((a, l) => a + (l.cost_total as number), 0);
  const totalVol = pieces.reduce((a, p) => a + p.vol, 0);
  const prepared = costed.map((l) => {
    const ranges = parseMarkRanges(l.element_ref);
    const covered = ranges.length > 0 ? pieces.filter((p) => rangesCover(ranges, p)) : pieces;
    const byArea = (l.uom ?? "").toLowerCase() === "m2" && covered.some((p) => (p.area ?? 0) > 0);
    const weight = (p: Pick<Piece, "vol" | "area">) => (byArea ? p.area ?? 0 : p.vol);
    return { l, ranges, covered: new Set(covered.map((p) => p.id)), total: covered.reduce((a, p) => a + weight(p), 0), weight };
  });
  return (piece) => {
    let cost = 0;
    let best: { l: AllocLine; v: number } | null = null;
    for (const x of prepared) {
      if (!x.covered.has(piece.id) || x.total <= 0) continue;
      const part = ((x.l.cost_total as number) * x.weight(piece)) / x.total;
      cost += part;
      if (x.ranges.length > 0 && (!best || part > best.v)) best = { l: x.l, v: part };
    }
    return { cost, share: totalCost > 0 && totalVol > 0 ? cost / totalCost : 0, line: best ? best.l : null };
  };
}
