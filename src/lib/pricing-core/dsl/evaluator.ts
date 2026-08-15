// Deterministic evaluator for the PricingEngine formula DSL (spec §5).
// Pure: no I/O, no Date.now — "now" comes in via hooks.pricingDate. Every
// evaluation is metered against a hard op budget so a stored formula can
// never run away, and all host-object access goes through own-property
// lookups on plain data (no prototype walking).

import { DslError, LIMITS, type Node, type Value } from "./ast";

export type ScaleEntry = { from: number; value: number };

/** Engine hooks the formula may call. Supplied by the calc core per evaluation. */
export type EvalHooks = {
  /** Value of an already-computed component in this line's waterfall. */
  lookup: (componentCode: string) => number;
  /** Value of a named subtotal accumulated so far. */
  subtotal: (ref: string) => number;
  /** ISO date (yyyy-mm-dd) the document is being priced for. */
  pricingDate: () => string;
};

export type EvalContext = {
  /** Plain-data context: document/line/customer/contract/policy/cost trees. */
  ctx: Record<string, unknown>;
  hooks: EvalHooks;
};

class Budget {
  private ops = 0;
  spend(pos: number): void {
    this.ops++;
    if (this.ops > LIMITS.maxEvalOps) {
      throw new DslError(`Formula exceeded the evaluation budget (${LIMITS.maxEvalOps} ops)`, pos);
    }
  }
}

function isPlainIndexable(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Own-property path resolution over plain data. Missing path → null, never undefined. */
function resolvePath(root: Record<string, unknown>, path: string[]): Value | unknown[] {
  let cur: unknown = root;
  for (const seg of path) {
    if (!isPlainIndexable(cur) || !Object.prototype.hasOwnProperty.call(cur, seg)) return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  if (cur === undefined) return null;
  if (Array.isArray(cur)) return cur;
  if (typeof cur === "number" || typeof cur === "boolean" || typeof cur === "string" || cur === null) return cur;
  // Objects are not first-class DSL values; treat as opaque-missing.
  return null;
}

function asNumber(v: Value | unknown[], what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new DslError(`${what} is not a finite number (got ${Array.isArray(v) ? "list" : JSON.stringify(v)})`, 0);
  }
  return v;
}

function asIsoDate(v: Value | unknown[], what: string): Date {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new DslError(`${what} is not an ISO date (yyyy-mm-dd)`, 0);
  }
  const d = new Date(`${v}T00:00:00Z`);
  if (isNaN(d.getTime())) throw new DslError(`${what} is not a valid date`, 0);
  return d;
}

/**
 * Tiered scale resolution: the last entry whose `from` <= basis wins.
 * (Graduated accumulation is a calc-core concern layered on top; the DSL's
 * scale() is always tiered — spec §5.)
 */
export function resolveScaleTiered(table: ScaleEntry[], basis: number): number {
  let value: number | null = null;
  for (const entry of table) {
    if (typeof entry?.from !== "number" || typeof entry?.value !== "number") {
      throw new DslError("scale table entries must be {from, value} numbers", 0);
    }
    if (basis >= entry.from) value = entry.value;
  }
  if (value === null) throw new DslError(`scale(): basis ${basis} is below the lowest tier`, 0);
  return value;
}

export function evaluate(node: Node, env: EvalContext): Value {
  const budget = new Budget();

  const evalNode = (n: Node): Value | unknown[] => {
    budget.spend(0);
    switch (n.kind) {
      case "num": return n.value;
      case "str": return n.value;
      case "bool": return n.value;
      case "null": return null;
      case "ctx": return resolvePath(env.ctx, n.path);

      case "unary": {
        const v = evalNode(n.operand);
        if (n.op === "-") return -asNumber(v, "operand of unary '-'");
        return !truthy(v);
      }

      case "binary": {
        // Short-circuit logic first.
        if (n.op === "&&") return truthy(evalNode(n.left)) ? truthy(evalNode(n.right)) : false;
        if (n.op === "||") return truthy(evalNode(n.left)) ? true : truthy(evalNode(n.right));

        const l = evalNode(n.left);
        const r = evalNode(n.right);

        if (n.op === "==" || n.op === "!=") {
          const eq = strictEquals(l, r);
          return n.op === "==" ? eq : !eq;
        }

        const ln = asNumber(l, `left side of '${n.op}'`);
        const rn = asNumber(r, `right side of '${n.op}'`);
        switch (n.op) {
          case "+": return ln + rn;
          case "-": return ln - rn;
          case "*": return ln * rn;
          case "/":
            if (rn === 0) throw new DslError("Division by zero", 0);
            return ln / rn;
          case "%":
            if (rn === 0) throw new DslError("Modulo by zero", 0);
            return ln % rn;
          case "<": return ln < rn;
          case "<=": return ln <= rn;
          case ">": return ln > rn;
          case ">=": return ln >= rn;
        }
        throw new DslError(`Unhandled operator "${n.op}"`, 0);
      }

      case "ternary":
        return truthy(evalNode(n.cond)) ? evalNode(n.then) : evalNode(n.else);

      case "call":
        return callFunction(n.name, n.args.map(evalNode), n, evalNode);
    }
  };

  const truthy = (v: Value | unknown[]): boolean => {
    if (Array.isArray(v)) return v.length > 0;
    return v !== null && v !== false && v !== 0 && v !== "";
  };

  const strictEquals = (l: Value | unknown[], r: Value | unknown[]): boolean => {
    if (Array.isArray(l) || Array.isArray(r)) throw new DslError("Lists cannot be compared with == / !=", 0);
    return l === r;
  };

  const callFunction = (
    name: string,
    args: (Value | unknown[])[],
    node: Extract<Node, { kind: "call" }>,
    evalArg: (n: Node) => Value | unknown[],
  ): Value => {
    const arity = (n: number) => {
      if (args.length !== n) throw new DslError(`${name}() expects ${n} argument${n === 1 ? "" : "s"}, got ${args.length}`, 0);
    };

    switch (name) {
      case "min": case "max": {
        if (args.length < 1) throw new DslError(`${name}() expects at least 1 argument`, 0);
        const nums = args.map((a, idx) => asNumber(a, `argument ${idx + 1} of ${name}()`));
        return name === "min" ? Math.min(...nums) : Math.max(...nums);
      }
      case "abs": {
        arity(1);
        return Math.abs(asNumber(args[0], "argument of abs()"));
      }
      case "round": {
        if (args.length < 1 || args.length > 2) throw new DslError("round() expects 1 or 2 arguments", 0);
        const value = asNumber(args[0], "argument 1 of round()");
        const decimals = args.length === 2 ? asNumber(args[1], "argument 2 of round()") : 0;
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
          throw new DslError("round() decimals must be an integer 0-6", 0);
        }
        const factor = 10 ** decimals;
        return Math.round(value * factor) / factor;
      }
      case "clamp": {
        arity(3);
        const [v, lo, hi] = args.map((a, idx) => asNumber(a, `argument ${idx + 1} of clamp()`));
        if (lo > hi) throw new DslError("clamp(): lower bound exceeds upper bound", 0);
        return Math.min(hi, Math.max(lo, v));
      }

      case "lookup": {
        arity(1);
        if (typeof args[0] !== "string") throw new DslError("lookup() expects a component code string", 0);
        return env.hooks.lookup(args[0]);
      }
      case "subtotal": {
        arity(1);
        if (typeof args[0] !== "string") throw new DslError("subtotal() expects a subtotal ref string", 0);
        return env.hooks.subtotal(args[0]);
      }
      case "scale": {
        arity(2);
        const table = args[0];
        if (!Array.isArray(table)) throw new DslError("scale() expects a scale table list as argument 1 (e.g. ctx.rule.scale)", 0);
        if (table.length > LIMITS.maxListItems) throw new DslError(`scale table exceeds ${LIMITS.maxListItems} entries`, 0);
        return resolveScaleTiered(table as ScaleEntry[], asNumber(args[1], "argument 2 of scale()"));
      }

      case "pricingDate": {
        arity(0);
        return env.hooks.pricingDate();
      }
      case "daysBetween": {
        arity(2);
        const a = asIsoDate(args[0], "argument 1 of daysBetween()");
        const b = asIsoDate(args[1], "argument 2 of daysBetween()");
        return Math.round((b.getTime() - a.getTime()) / 86_400_000);
      }

      // Bounded aggregation over a ctx list (spec §5: cost_items only by
      // convention; the parser can't see data shape, so the bound is on size
      // and field access, enforced here).
      case "sum": {
        arity(2);
        const list = args[0];
        if (!Array.isArray(list)) throw new DslError("sum() expects a ctx list as argument 1", 0);
        if (list.length > LIMITS.maxListItems) throw new DslError(`sum() list exceeds ${LIMITS.maxListItems} items`, 0);
        const field = args[1];
        if (typeof field !== "string") throw new DslError("sum() expects a field name string as argument 2", 0);
        let total = 0;
        for (const item of list) {
          budget.spend(0);
          const v = isPlainIndexable(item) && Object.prototype.hasOwnProperty.call(item, field)
            ? (item as Record<string, unknown>)[field]
            : null;
          if (v === null || v === undefined) continue; // absent field contributes 0
          total += asNumber(v as Value, `field "${field}" in sum()`);
        }
        return total;
      }
      case "count": {
        arity(1);
        const list = args[0];
        if (!Array.isArray(list)) throw new DslError("count() expects a ctx list", 0);
        return list.length;
      }
    }
    // Parser whitelists function names, so this is unreachable — keep the
    // throw so a future grammar addition can't silently return null.
    throw new DslError(`Unknown function "${name}"`, 0);
    void node; void evalArg;
  };

  const result = evalNode(node);
  if (Array.isArray(result)) throw new DslError("A formula must produce a number/boolean/string, not a list", 0);
  return result;
}
