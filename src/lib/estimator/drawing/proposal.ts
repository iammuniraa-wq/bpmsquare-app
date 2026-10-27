// From a measured DXF drawing to the same kind of answer "Read the email" gives (pure). The template's drawing_map says which
// layers feed which number input; an input with no rule is not touched (the other reader and the person fill it).
// The lead merges this fragment into the intake proposal; it never writes anything itself.

import type { IntakeField, IntakeProposal } from "@/lib/estimator/ai";
import type { DrawingMapRule, TemplateInput } from "@/lib/estimator/types";
import { measureRule, type MeasuredTable } from "./measure";

export type DxfProposal = Pick<IntakeProposal, "values" | "assumptions" | "adjusted"> & { fields: Record<string, IntakeField> };

const MEASURE_WORDS = { length_m: "length", area_m2: "area", count: "count" } as const;
const UNIT_OF = { length_m: "m", area_m2: "m2", count: "" } as const;

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const show = (n: number) => String(round(n, 2));

/** Layers as the drawing spells them, de-duplicated, for the "source" line and the layer field. */
const joinLayers = (layers: readonly string[]) => [...new Set(layers)].join(", ");

export function dxfProposal(
  inputs: readonly TemplateInput[],
  drawingMap: readonly DrawingMapRule[] | null | undefined,
  measured: Pick<MeasuredTable, "rows" | "factor">,
  opts: { file: string }
): DxfProposal {
  const out: DxfProposal = { values: {}, fields: {}, assumptions: [], adjusted: [] };
  const byKey = new Map(inputs.map((i) => [i.key, i]));
  const done = new Set<string>();
  for (const rule of drawingMap ?? []) {
    const input = byKey.get(rule.input);
    if (!input || input.type !== "number" || done.has(rule.input)) continue;
    const m = measureRule(measured, rule);
    if (m.value === null) {
      if (m.note) out.assumptions.push(`${input.label}: ${m.note} (${opts.file})`);
      continue;
    }
    done.add(rule.input);
    let n = rule.measure === "count" ? Math.round(m.value) : round(m.value, 2);
    const measuredN = n;
    if (input.min !== undefined && n < input.min) n = input.min;
    if (input.max !== undefined && n > input.max) n = input.max;
    if (n !== measuredN) {
      out.assumptions.push(`${input.label}: ${show(measuredN)} was measured in ${opts.file}, which is outside ${input.min ?? "any"} to ${input.max ?? "any"}, so ${show(n)} is proposed instead.`);
      out.adjusted.push(input.key);
    }
    const unit = UNIT_OF[rule.measure];
    const layers = joinLayers(m.matched);
    out.values[input.key] = n;
    out.fields[input.key] = {
      status: "found",
      source: `${MEASURE_WORDS[rule.measure]} on layer${m.matched.length === 1 ? "" : "s"} ${layers}: ${show(measuredN)}${unit ? ` ${unit}` : ""}`,
      file: opts.file,
      layer: layers,
    };
  }
  return out;
}
