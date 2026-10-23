// The safety net for moving Fence projects onto estimates (docs/estimator-architecture.md
// section 18): for fixed fence inputs, the fence TEMPLATE's bill of materials has to equal
// what src/lib/fence (geometry.ts + bom.ts + materialMatch.ts) produces today, line for
// line, and ask the catalogue for the same product tags.

import { describe, expect, it } from "vitest";
import { computeGeometry, type FenceGateInput } from "../fence/geometry";
import { computeBom, type FenceAccessories } from "../fence/bom";
import { buildMaterialRequests, materialKey } from "../fence/materialMatch";
import { computeEstimate } from "./compute";
import { validateTemplate } from "./template";
import { CHAINLINK_FENCE_STARTER, FENCE_MESH_OPTIONS, FENCE_PROFILE_OPTIONS } from "./starterTemplates";
import { parseMatchKey } from "./productMatch";

type Case = {
  name: string;
  length: number;
  closed: boolean;
  profile: (typeof FENCE_PROFILE_OPTIONS)[number]["key"];
  mesh: (typeof FENCE_MESH_OPTIONS)[number]["key"];
  height: number;
  straining?: number;
  single?: [number, number];
  double?: [number, number];
  sliding?: [number, number];
  acc: FenceAccessories;
};

const ALL: FenceAccessories = { truss_rods: true, tension_wire: true, tie_wire: true, barbed_wire: true };
const NONE: FenceAccessories = { truss_rods: false, tension_wire: false, tie_wire: false, barbed_wire: false };

const CASES: Case[] = [
  { name: "the configurator's own default", length: 500, closed: true, profile: "general", mesh: "standard", height: 2, double: [2, 5], acc: { truss_rods: true, tension_wire: true, tie_wire: true, barbed_wire: false } },
  { name: "open run, vehicle compound, mixed gates", length: 120, closed: false, profile: "vehicle", mesh: "high_security", height: 2.4, single: [1, 1.2], sliding: [1, 6], acc: { truss_rods: false, tension_wire: true, tie_wire: false, barbed_wire: true } },
  { name: "long bonded perimeter, everything on", length: 1250.5, closed: true, profile: "bonded", mesh: "mini_mesh", height: 1.8, double: [3, 4.5], single: [2, 1], acc: ALL },
  { name: "short run, no gates, no accessories", length: 40, closed: false, profile: "general", mesh: "standard", height: 1.5, acc: NONE },
  { name: "tiny closed fence where the line posts run out", length: 10, closed: true, profile: "bonded", mesh: "standard", height: 2, single: [1, 1], acc: ALL },
  { name: "gates wider than the fence (no fabric)", length: 4, closed: false, profile: "general", mesh: "standard", height: 2, double: [1, 5], acc: ALL },
  { name: "tight straining spacing", length: 300, closed: true, profile: "vehicle", mesh: "standard", height: 3, straining: 25, double: [1, 6], acc: ALL },
];

function oldWay(c: Case) {
  const profile = FENCE_PROFILE_OPTIONS.find((p) => p.key === c.profile)!;
  const mesh = FENCE_MESH_OPTIONS.find((m) => m.key === c.mesh)!;
  const gates: FenceGateInput[] = [];
  const add = (type: FenceGateInput["type"], spec: [number, number] | undefined) => {
    for (let i = 0; i < (spec?.[0] ?? 0); i++) gates.push({ type, width_m: spec![1] });
  };
  add("single_swing", c.single); add("double_swing", c.double); add("sliding", c.sliding);
  const geometry = computeGeometry({
    layout: c.closed ? "closed_perimeter" : "open_run", total_length_m: c.length, post_spacing_m: profile.value,
    embedment_m: 0.9, straining_spacing_m: c.straining ?? 100, gates, fabric_height_m: c.height,
  });
  const bom = computeBom({ geometry, fabric_height_m: c.height, total_length_m: c.length, accessories: c.acc });
  const requests = buildMaterialRequests(geometry, bom);
  return { geometry, requests, profile, mesh };
}

const params = (c: Case) => ({
  total_length_m: c.length, closed_perimeter: c.closed, post_spacing_m: c.profile, fabric_height_m: c.height, mesh: c.mesh, coating: "pvc",
  straining_spacing_m: c.straining ?? 100,
  gates_single_n: c.single?.[0] ?? 0, gates_single_w: c.single?.[1] ?? 1.2,
  gates_double_n: c.double?.[0] ?? 0, gates_double_w: c.double?.[1] ?? 5,
  gates_sliding_n: c.sliding?.[0] ?? 0, gates_sliding_w: c.sliding?.[1] ?? 6,
  truss_rods: c.acc.truss_rods, tension_wire: c.acc.tension_wire, tie_wire: c.acc.tie_wire, barbed_wire: c.acc.barbed_wire,
});

const valid = validateTemplate({
  geometry: CHAINLINK_FENCE_STARTER.geometry, inputs: CHAINLINK_FENCE_STARTER.inputs, rates: CHAINLINK_FENCE_STARTER.rates, rules: CHAINLINK_FENCE_STARTER.rules,
});

describe("the fence starter template", () => {
  it("validates, with no warnings about unused inputs", () => {
    expect(valid.issues).toEqual([]);
    expect(valid.ok).toBe(true);
    expect(valid.warnings).toEqual([]);
  });
});

describe.each(CASES)("fence parity: $name", (c) => {
  const old = oldWay(c);
  const r = computeEstimate(valid.template!, params(c));

  it("computes", () => {
    expect(r.ok).toBe(true);
  });

  it("gives the same quantity for every material the configurator lists, and no others", () => {
    if (!r.ok) throw new Error("did not compute");
    const rule = new Map(valid.template!.rules.map((x) => [x.code, x]));
    const fresh = new Map<string, { qty: number; uom: string }>();
    for (const l of r.lines) {
      const cost = rule.get(l.code)!.cost;
      if (cost.kind !== "product" || !cost.match) throw new Error(`${l.code} is not a match rule`);
      fresh.set(cost.match.attrs.fence_kind, { qty: l.qty, uom: l.uom });
    }
    const expected = new Map(old.requests.map((q) => [q.fence_kind as string, q]));
    expect([...fresh.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [kind, q] of expected) {
      const got = fresh.get(kind)!;
      expect(got.qty, `${kind} quantity`).toBeCloseTo(q.qty, 3);
      expect(got.uom, `${kind} unit`).toBe(q.uom === "sets" ? "sets" : q.uom);
    }
  });

  it("exposes the geometry's own post counts", () => {
    if (!r.ok) throw new Error("did not compute");
    const qty = (code: string) => r.lines.find((l) => l.code === code)?.qty ?? 0;
    expect(qty("line_posts")).toBe(old.geometry.line_posts);
    expect(qty("straining_posts")).toBe(old.geometry.straining_posts);
    expect(qty("corner_posts")).toBe(old.geometry.corner_posts);
    expect(qty("terminal_posts")).toBe(old.geometry.terminal_posts);
    expect(qty("gate_posts")).toBe(old.geometry.gate_posts);
    expect(r.model?.pieces.filter((p) => ["LP", "SP", "CP", "TP", "GP"].includes(p.code)).length).toBe(old.geometry.total_posts);
  });

  it("asks the catalogue for the product the configurator matched (same kind, pipe class, mesh and coating)", () => {
    if (!r.ok) throw new Error("did not compute");
    const selections = { pipe_class: old.profile.attrs.pipe_class, mesh_spec: old.mesh.attrs.mesh_spec, coating: "PVC coated" };
    const rule = new Map(valid.template!.rules.map((x) => [x.code, x]));
    for (const l of r.lines) {
      const attrs = parseMatchKey(l.sku ?? "");
      expect(attrs, `${l.code} item key`).not.toBeNull();
      const kind = rule.get(l.code)!.cost.kind === "product" ? attrs!.fence_kind : "";
      const oldKey = materialKey(kind, selections);
      const newKey = materialKey(kind, { pipe_class: attrs!.pipe_class, mesh_spec: attrs!.mesh_spec, coating: attrs!.coating });
      expect(newKey, `${l.code} catalogue key`).toBe(oldKey);
    }
  });
});

describe("fence parity: the cost", () => {
  it("prices a line as quantity times the product's cost, like the configurator's list price sum", () => {
    const c = CASES[0];
    const old = oldWay(c);
    const list: Record<string, number> = {};
    const r1 = computeEstimate(valid.template!, params(c));
    if (!r1.ok) throw new Error("did not compute");
    const rule = new Map(valid.template!.rules.map((x) => [x.code, x]));
    const unit: Record<string, number> = {};
    for (const l of r1.lines) {
      const kind = (rule.get(l.code)!.cost as unknown as { match: { attrs: { fence_kind: string } } }).match.attrs.fence_kind;
      unit[l.code] = 10 + kind.length; // any distinct, non-round per-kind cost
      list[kind] = unit[l.code];
    }
    const r2 = computeEstimate(valid.template!, params(c), { unit_costs: unit });
    if (!r2.ok) throw new Error("did not compute");
    const oldTotal = old.requests.reduce((s, q) => s + list[q.fence_kind as string] * q.qty, 0);
    expect(r2.summary.cost_total).toBeCloseTo(oldTotal, 1);
    expect(r2.complete).toBe(true);
  });
});
