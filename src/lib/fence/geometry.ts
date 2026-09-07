// Pure geometry — no DB, no tenant context. Every downstream fence module
// (BOM, cost, 3D preview) reads this output and nothing else, so the shape
// here is the contract for all of them (docs/fence-configurator-architecture.md §5).
//
// The exact post-count split (line vs. straining vs. corner) is an open
// engineering-review item, not a solved problem — see that doc's §5 note
// on why this isn't fitted to reproduce a competitor's undisclosed formula.

export type FenceLayout = "open_run" | "closed_perimeter";

export interface FenceGateInput {
  type: "single_swing" | "double_swing" | "sliding";
  width_m: number;
}

export interface FenceGeometryInput {
  layout: FenceLayout;
  total_length_m: number;
  post_spacing_m: number;
  embedment_m: number;
  straining_spacing_m: number;
  gates: FenceGateInput[];
  fabric_height_m: number;
}

export interface FenceGeometryResult {
  line_posts: number;
  straining_posts: number;
  corner_posts: number;
  terminal_posts: number;
  gate_posts: number;
  total_posts: number;
  fabric_area_m2: number;
  gate_width_sum_m: number;
}

function assertPositive(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`FenceGeometryInput.${name} must be a positive finite number, got ${value}`);
  }
}

export function computeGeometry(input: FenceGeometryInput): FenceGeometryResult {
  assertPositive("total_length_m", input.total_length_m);
  assertPositive("post_spacing_m", input.post_spacing_m);
  assertPositive("straining_spacing_m", input.straining_spacing_m);
  assertPositive("fabric_height_m", input.fabric_height_m);
  if (input.embedment_m <= 0) throw new RangeError("FenceGeometryInput.embedment_m must be positive");

  const isClosed = input.layout === "closed_perimeter";
  const corner_posts = isClosed ? 4 : 0;
  const terminal_posts = isClosed ? 0 : 2;
  const gate_posts = input.gates.length * 2;

  // Straining posts break each run into segments no longer than
  // straining_spacing_m; corners/terminals already anchor the run ends.
  const straining_posts = Math.max(0, Math.floor(input.total_length_m / input.straining_spacing_m) - corner_posts);

  const total_posts_raw = Math.round(input.total_length_m / input.post_spacing_m);
  const line_posts = Math.max(0, total_posts_raw - corner_posts - terminal_posts - straining_posts - gate_posts);

  const total_posts = line_posts + straining_posts + corner_posts + terminal_posts + gate_posts;

  const gate_width_sum_m = input.gates.reduce((sum, g) => sum + g.width_m, 0);
  const fabric_area_m2 = Math.max(0, input.total_length_m * input.fabric_height_m - gate_width_sum_m * input.fabric_height_m);

  return { line_posts, straining_posts, corner_posts, terminal_posts, gate_posts, total_posts, fabric_area_m2, gate_width_sum_m };
}
