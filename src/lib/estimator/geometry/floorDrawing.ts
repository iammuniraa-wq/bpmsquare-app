// The drawing of a tiled floor, as plain SVG path data. Pure (no React, no DOM)
// so it is unit-tested; components/estimator/viewer/FloorPreview.tsx only
// paints these strings. Coordinates are metres with y flipped (SVG y runs down,
// the room's width runs up), so the drawing is the floor seen from above with
// the laying corner at the bottom left.

import type { Poly, TileLayout } from "./tilesFloor";

export type FloorDrawing = {
  viewBox: { x: number; y: number; w: number; h: number };
  /** Text size in drawing units, scaled to the room so labels read at any size. */
  fontSize: number;
  /** Cut-tile hatch spacing in drawing units. */
  hatchPitch: number;
  /** The room outline (a rectangle, or the L). */
  room: string;
  /** Whole tiles in three close tones, one path each. */
  whole: [string, string, string];
  /** Cut tiles, all in one path. */
  cut: string;
  /** Border strips, all in one path. */
  strips: string;
  dims: {
    top: { x1: number; x2: number; y: number; label: string };
    left: { y1: number; y2: number; x: number; label: string };
  };
};

const f = (n: number): string => String(Math.round(n * 1000) / 1000);

function path(polys: readonly Poly[], width: number): string {
  let d = "";
  for (const p of polys) {
    d += `M${p.map((q) => `${f(q[0])} ${f(width - q[1])}`).join("L")}Z`;
  }
  return d;
}

export function buildFloorDrawing(layout: TileLayout): FloorDrawing {
  const { length: L, width: W, cutL, cutW } = layout.inputs;
  const fs = Math.max(L, W) * 0.055;

  const outline: [number, number][] = cutL > 0
    ? [[0, 0], [L, 0], [L, W - cutW], [L - cutL, W - cutW], [L - cutL, W], [0, W]]
    : [[0, 0], [L, 0], [L, W], [0, W]];

  const whole: [Poly[], Poly[], Poly[]] = [[], [], []];
  const cut: Poly[] = [];
  for (const t of layout.tiles) {
    if (t.whole) whole[t.tone % 3].push(t.polys[0]);
    else cut.push(...t.polys);
  }
  const strips: Poly[] = layout.strips.flatMap((s) => s.polys);

  const mx = fs * 3.4;
  const my = fs * 3;
  return {
    viewBox: { x: -mx, y: -my, w: L + mx + fs * 1.6, h: W + my + fs * 1.6 },
    fontSize: fs,
    hatchPitch: Math.max(L, W) * 0.012,
    room: path([outline], W),
    whole: [path(whole[0], W), path(whole[1], W), path(whole[2], W)],
    cut: path(cut, W),
    strips: path(strips, W),
    dims: {
      top: { x1: 0, x2: L, y: -fs * 1.4, label: `${f(L)} m` },
      left: { y1: 0, y2: W, x: -fs * 1.4, label: `${f(W)} m` },
    },
  };
}

/** Deterministic dots for a speckled texture (same every render, no Math.random). */
export function speckleDots(count: number, size: number, seed = 7): { x: number; y: number; r: number }[] {
  let s = seed;
  const next = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: { x: number; y: number; r: number }[] = [];
  for (let i = 0; i < count; i++) out.push({ x: next() * size, y: next() * size, r: 0.004 + next() * 0.008 });
  return out;
}
