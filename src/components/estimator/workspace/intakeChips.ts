import type { TemplateInput } from "@/lib/estimator/types";
import type { IntakeProposal } from "@/lib/estimator/ai";

const num = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 3 });

/** One short phrase per input the email gave a value for, in the template's own order and words. */
export function understoodChips(inputs: readonly TemplateInput[], proposal: Pick<IntakeProposal, "values">): string[] {
  const out: string[] = [];
  for (const i of inputs) {
    const v = proposal.values[i.key];
    if (v === undefined) continue;
    if (i.type === "boolean") out.push(`${i.label}: ${v === true ? "yes" : "no"}`);
    else if (i.type === "select") out.push(`${i.label}: ${i.options?.find((o) => o.key === v)?.label ?? String(v)}`);
    else out.push(`${i.label}: ${typeof v === "number" ? num(v) : String(v)}${i.unit ? ` ${i.unit}` : ""}`);
  }
  return out;
}

/** What was guessed or left to defaults: the model's own assumptions, plus the inputs the email did not mention. */
export function assumedChips(inputs: readonly TemplateInput[], proposal: Pick<IntakeProposal, "values" | "assumptions">): string[] {
  const unmentioned = inputs.filter((i) => proposal.values[i.key] === undefined).map((i) => `${i.label} not mentioned, using ${describeDefault(i)}`);
  return [...proposal.assumptions, ...unmentioned];
}

function describeDefault(i: TemplateInput): string {
  if (i.type === "boolean") return i.default === true ? "yes" : "no";
  if (i.type === "select") return i.options?.find((o) => o.key === i.default)?.label ?? String(i.default);
  return `${typeof i.default === "number" ? num(i.default) : String(i.default)}${i.unit ? ` ${i.unit}` : ""}`;
}
