// The hardware layer on top of geometry.ts's post/fabric counts — tension
// bands, brace bands, rail ends, carriage bolts, truss sets, tension/tie/
// barbed wire. Universal chain-link engineering (owner decision #3 in
// docs/fence-configurator-architecture.md), not a tenant-configurable
// formula, so this stays plain, tested TypeScript.
//
// geometry.ts owns "how many posts / how much fabric"; this module owns
// "what hardware do those posts and that fabric need." Phase C combines
// both outputs — plus the posts/fabric themselves — into one priced list.

import type { FenceGeometryResult } from "./geometry";

export interface FenceAccessories {
  truss_rods: boolean;
  tension_wire: boolean;
  tie_wire: boolean;
  barbed_wire: boolean;
}

export interface BomInput {
  geometry: FenceGeometryResult;
  fabric_height_m: number;
  total_length_m: number;
  accessories: FenceAccessories;
}

export type BomUnit = "pcs" | "sets" | "m" | "kg";

export interface BomLine {
  kind:
    | "tension_band"
    | "brace_band"
    | "rail_end"
    | "carriage_bolt_set"
    | "truss_rod_set"
    | "tension_wire"
    | "tie_wire"
    | "barbed_wire";
  qty: number;
  unit: BomUnit;
}

const TENSION_BAND_SPACING_M = 0.3; // max vertical gap between bands clamping fabric to a terminal-type post
const TENSION_WIRE_ROWS = 3; // top, middle, bottom
const TIE_WIRE_KG_PER_M = 0.0186; // ties fabric to posts/rail at <=300/450mm intervals
const BARBED_WIRE_STRANDS = 3;

export function computeBom(input: BomInput): BomLine[] {
  const g = input.geometry;
  const terminalTypePosts = g.corner_posts + g.terminal_posts + g.straining_posts + g.gate_posts;
  const bandsPerPost = Math.max(3, Math.ceil(input.fabric_height_m / TENSION_BAND_SPACING_M));

  const tensionBands = terminalTypePosts * bandsPerPost;
  const braceBands = terminalTypePosts * 2;
  const railEnds = terminalTypePosts * 2;
  const carriageBoltSets = tensionBands + braceBands;
  const trussSets = input.accessories.truss_rods ? g.corner_posts + g.straining_posts : 0;
  const tensionWireM = input.accessories.tension_wire ? Math.round(input.total_length_m * TENSION_WIRE_ROWS) : 0;
  const tieWireKg = input.accessories.tie_wire ? round1(input.total_length_m * TIE_WIRE_KG_PER_M) : 0;
  const barbedWireM = input.accessories.barbed_wire ? input.total_length_m * BARBED_WIRE_STRANDS : 0;

  const lines: BomLine[] = [
    { kind: "tension_band", qty: tensionBands, unit: "pcs" },
    { kind: "brace_band", qty: braceBands, unit: "pcs" },
    { kind: "rail_end", qty: railEnds, unit: "pcs" },
    { kind: "carriage_bolt_set", qty: carriageBoltSets, unit: "sets" },
  ];
  if (trussSets > 0) lines.push({ kind: "truss_rod_set", qty: trussSets, unit: "sets" });
  if (tensionWireM > 0) lines.push({ kind: "tension_wire", qty: tensionWireM, unit: "m" });
  if (tieWireKg > 0) lines.push({ kind: "tie_wire", qty: tieWireKg, unit: "kg" });
  if (barbedWireM > 0) lines.push({ kind: "barbed_wire", qty: barbedWireM, unit: "m" });

  return lines;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
