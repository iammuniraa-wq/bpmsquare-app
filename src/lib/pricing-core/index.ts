// PricingEngine core — pure TypeScript, zero framework/persistence imports.
// Boundary is CI-enforced (eslint.config.mjs no-restricted-imports block);
// see docs/pricing-engine-architecture.md §11.3. Persistence adapters and
// routes live OUTSIDE this directory and hand it plain data.

export { DSL_VERSION, DslError, LIMITS, FUNCTIONS } from "./dsl/ast";
export type { Node, Value, BinaryOp } from "./dsl/ast";
export { parseFormula } from "./dsl/parser";
export { evaluate, resolveScaleTiered } from "./dsl/evaluator";
export type { EvalContext, EvalHooks, ScaleEntry } from "./dsl/evaluator";

import { parseFormula } from "./dsl/parser";
import { evaluate, type EvalContext } from "./dsl/evaluator";
import type { Value } from "./dsl/ast";

/** Parse + evaluate in one call. Prefer parseFormula() once + evaluate() many for stored rules. */
export function runFormula(src: string, env: EvalContext): Value {
  return evaluate(parseFormula(src), env);
}
