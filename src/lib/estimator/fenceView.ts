// What the fence preview (plan and 3D) needs, read from the SAME model the price is added up
// from, so the picture and the quote cannot disagree. Pure, no I/O. The 3D scene is the
// Fence configurator's own (components/fence/Fence3DView), which takes a FenceGeometryResult.

import type { FenceGateInput, FenceGeometryResult, FenceLayout } from "../fence/geometry";
import type { GeometryModel } from "./geometry";
import { fenceGatesFromInputs } from "./geometry/chainlinkFence";
import type { TemplateInput } from "./types";

export type FencePost = { x: number; z: number; code: string };

export type FenceView = {
  layout: FenceLayout;
  totalLength: number;
  gates: FenceGateInput[];
  fabricHeight: number;
  geometry: FenceGeometryResult;
  coating: string;
  meshSpec: string;
  posts: FencePost[];
  /** Footprint, metres (a closed fence is drawn as a 2:1 rectangle). */
  w: number;
  d: number;
  /** Gate centres, for the plan. */
  gatePoints: { x: number; z: number; width: number }[];
};

type Params = Readonly<Record<string, number | string | boolean>>;

/** The text a chosen option stands for in the catalogue (`attrs`), or its label. */
function chosenAttr(inputs: readonly TemplateInput[], params: Params, attr: string): string {
  for (const i of inputs) {
    if (i.type !== "select") continue;
    const o = (i.options ?? []).find((x) => x.key === params[i.key]);
    if (o?.attrs?.[attr]) return o.attrs[attr];
  }
  return "";
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export function fenceViewOf(model: GeometryModel | null, inputs: readonly TemplateInput[], params: Params): FenceView | null {
  if (!model || model.geometry !== "chainlink_fence") return null;
  const count = (code: string) => model.pieces.filter((p) => p.code === code).length;
  const fabric = model.pieces.find((p) => p.code === "FB");
  const gatePieces = model.pieces.filter((p) => p.code === "GT");
  const geometry: FenceGeometryResult = {
    line_posts: count("LP"), straining_posts: count("SP"), corner_posts: count("CP"), terminal_posts: count("TP"), gate_posts: count("GP"),
    total_posts: ["LP", "SP", "CP", "TP", "GP"].reduce((a, c) => a + count(c), 0),
    fabric_area_m2: fabric?.area ?? 0,
    gate_width_sum_m: gatePieces.reduce((a, g) => a + g.dims.w, 0),
  };
  return {
    layout: geometry.corner_posts > 0 ? "closed_perimeter" : "open_run",
    totalLength: num(params.total_length_m, 0),
    gates: fenceGatesFromInputs(params),
    fabricHeight: num(params.fabric_height_m, 2),
    geometry,
    coating: chosenAttr(inputs, params, "coating"),
    meshSpec: chosenAttr(inputs, params, "mesh_spec"),
    posts: model.pieces.filter((p) => p.kind === "col").map((p) => ({ x: p.pos[0], z: p.pos[2], code: p.code })),
    w: model.w,
    d: model.d,
    gatePoints: gatePieces.map((g) => ({ x: g.pos[0], z: g.pos[2], width: g.dims.w })),
  };
}
