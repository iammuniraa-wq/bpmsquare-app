// PricingEngine formula DSL — closed AST (spec §5, grammar v1, frozen).
// Pure data structures: no evaluation, no I/O, no framework imports.

export const DSL_VERSION = 1;

export type Value = number | boolean | string | null;

export type Node =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "bool"; value: boolean }
  | { kind: "null" }
  | { kind: "ctx"; path: string[] }                       // ctx.cost.material.copper_per_kg
  | { kind: "unary"; op: "-" | "!"; operand: Node }
  | { kind: "binary"; op: BinaryOp; left: Node; right: Node }
  | { kind: "ternary"; cond: Node; then: Node; else: Node }
  | { kind: "call"; name: string; args: Node[] };

export type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "<" | "<=" | ">" | ">="
  | "==" | "!="
  | "&&" | "||";

/** Grammar v1's callable surface. Anything else is a parse-time error. */
export const FUNCTIONS = new Set([
  "min", "max", "round", "clamp", "abs",
  "lookup", "subtotal", "scale",
  "daysBetween", "pricingDate",
  "sum", "count",
]);

export class DslError extends Error {
  constructor(message: string, public readonly pos: number) {
    super(`${message} (at position ${pos})`);
    this.name = "DslError";
  }
}

/** Hard limits (spec §5): stored formulas are data with unbounded lifetime. */
export const LIMITS = {
  maxFormulaLength: 2000,
  maxAstDepth: 24,
  maxEvalOps: 10_000,
  maxListItems: 500, // bounded sum/count over ctx.line.cost_items
} as const;
