// The Project Estimator's formula language (docs/estimator-architecture.md §1).
//
// A tiny, safe expression language a tenant admin types into a template rule:
// `ceil(wall_perimeter_m / panel_width_m) * wall_height_m`. Hand-written
// tokenizer -> recursive-descent parser -> tree-walking evaluator. There is no
// eval, no Function constructor and no property access: an identifier is only
// ever looked up as an OWN key of the scope object the caller passes in, so
// `constructor` or `__proto__` are simply unknown names.
//
// Grammar (lowest to highest precedence):
//   expr       := or
//   or         := and ( "or" and )*
//   and        := not ( "and" not )*
//   not        := "not" not | comparison
//   comparison := additive ( ("<"|"<="|">"|">="|"=="|"!=") additive )?   (no chaining)
//   additive   := term ( ("+"|"-") term )*
//   term       := unary ( ("*"|"/") unary )*
//   unary      := ("-"|"+") unary | primary
//   primary    := number | identifier | call | "(" expr ")"
//   call       := name "(" [ expr ( "," expr )* ] ")"
//
// Values are plain numbers. Comparisons and `and`/`or`/`not` yield 1 or 0, and
// any non-zero number is "true". `and`, `or` and `if` short-circuit, so
// `if(x == 0, 0, 100 / x)` never divides by zero.
//
// Failure is always a returned error with a position, never a throw and never
// Infinity or NaN: division by zero, overflow and over-long or over-deep input
// are all rejected with a message the template editor can show.

export const MAX_FORMULA_LENGTH = 1000;
export const MAX_FORMULA_NODES = 500;
export const MAX_FORMULA_DEPTH = 40;
export const MAX_EVAL_STEPS = 10_000;

export type FormulaErrorCode =
  | "empty"
  | "too_long"
  | "too_complex"
  | "syntax"
  | "unknown_identifier"
  | "unknown_function"
  | "arity"
  | "divide_by_zero"
  | "not_finite"
  | "invalid_argument"
  | "step_limit";

export type FormulaError = {
  code: FormulaErrorCode;
  /** Human-readable, already includes the position. */
  message: string;
  /** 0-based character offset into the source. */
  position: number;
};

export type FormulaResult = { ok: true; value: number } | { ok: false; error: FormulaError };

// ── AST ──────────────────────────────────────────────────────────────────────

type Node =
  | { t: "num"; v: number; pos: number }
  | { t: "id"; name: string; pos: number }
  | { t: "unary"; op: "-" | "+" | "not"; arg: Node; pos: number }
  | { t: "bin"; op: BinaryOp; l: Node; r: Node; pos: number }
  | { t: "call"; fn: string; args: Node[]; pos: number };

type BinaryOp = "+" | "-" | "*" | "/" | "<" | "<=" | ">" | ">=" | "==" | "!=" | "and" | "or";

export type FormulaAst = Node;

// Functions and their allowed argument counts. A name here is never treated as
// a plain identifier when followed by "(".
const FUNCTIONS: Record<string, { min: number; max: number }> = {
  ceil: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
  min: { min: 1, max: 32 },
  max: { min: 1, max: 32 },
  if: { min: 3, max: 3 },
};

export const FORMULA_FUNCTIONS: readonly string[] = Object.keys(FUNCTIONS);
const KEYWORDS = new Set(["and", "or", "not"]);

class FormulaFail extends Error {
  constructor(public code: FormulaErrorCode, message: string, public position: number) {
    super(message);
  }
  toError(): FormulaError {
    return { code: this.code, message: this.message, position: this.position };
  }
}

const at = (pos: number) => `at position ${pos + 1}`;

// ── Rounding helper shared with the compute pipeline ─────────────────────────

/** Round half away from zero to `dp` decimal places, without the classic
 *  binary-representation misses (1.005 -> 1.01, 2.675 -> 2.68). */
export function roundHalfAway(x: number, dp = 0): number {
  if (!Number.isFinite(x)) return x;
  const f = 10 ** dp;
  const shifted = Number((Math.abs(x) * f).toPrecision(15));
  const r = Math.round(shifted) / f;
  return x < 0 && r !== 0 ? -r : r;
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

type Token =
  | { k: "num"; v: number; pos: number; text: string }
  | { k: "id"; name: string; pos: number }
  | { k: "op"; op: string; pos: number }
  | { k: "lp" | "rp" | "comma" | "eof"; pos: number };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const start = i;
      while (i < src.length && src[i] >= "0" && src[i] <= "9") i++;
      if (src[i] === ".") {
        i++;
        while (i < src.length && src[i] >= "0" && src[i] <= "9") i++;
      }
      const text = src.slice(start, i);
      // "2x" or "1.5m": a number glued to a letter is almost always a typo for
      // an implied multiplication, which this language does not have.
      if (i < src.length && /[A-Za-z_]/.test(src[i])) {
        throw new FormulaFail("syntax", `Unexpected "${src[i]}" right after the number ${text} ${at(i)}. Use * to multiply.`, i);
      }
      const v = Number(text);
      if (!Number.isFinite(v)) throw new FormulaFail("syntax", `The number ${text.slice(0, 20)}... is too large ${at(start)}.`, start);
      out.push({ k: "num", v, pos: start, text });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      out.push({ k: "id", name: src.slice(start, i), pos: start });
      continue;
    }
    switch (c) {
      case "(": out.push({ k: "lp", pos: i }); i++; continue;
      case ")": out.push({ k: "rp", pos: i }); i++; continue;
      case ",": out.push({ k: "comma", pos: i }); i++; continue;
      case "+": case "-": case "*": case "/":
        out.push({ k: "op", op: c, pos: i }); i++; continue;
      case "<": case ">":
        if (src[i + 1] === "=") { out.push({ k: "op", op: c + "=", pos: i }); i += 2; }
        else { out.push({ k: "op", op: c, pos: i }); i++; }
        continue;
      case "=":
        if (src[i + 1] === "=") { out.push({ k: "op", op: "==", pos: i }); i += 2; continue; }
        throw new FormulaFail("syntax", `A single = is not an operator ${at(i)}. Use == to compare.`, i);
      case "!":
        if (src[i + 1] === "=") { out.push({ k: "op", op: "!=", pos: i }); i += 2; continue; }
        throw new FormulaFail("syntax", `Unexpected "!" ${at(i)}. Use != to compare, or the word "not".`, i);
      default:
        throw new FormulaFail("syntax", `Unexpected character "${c.charCodeAt(0) > 31 ? c : "?"}" ${at(i)}.`, i);
    }
  }
  out.push({ k: "eof", pos: src.length });
  return out;
}

// ── Parser ───────────────────────────────────────────────────────────────────

class Parser {
  private p = 0;
  private nodes = 0;
  private depth = 0;
  constructor(private toks: Token[]) {}

  private peek(): Token { return this.toks[this.p]; }
  private next(): Token { return this.toks[this.p++]; }

  private count(pos: number): void {
    if (++this.nodes > MAX_FORMULA_NODES) {
      throw new FormulaFail("too_complex", `The formula is too complex (more than ${MAX_FORMULA_NODES} parts) ${at(pos)}.`, pos);
    }
  }

  private enter(pos: number): void {
    if (++this.depth > MAX_FORMULA_DEPTH) {
      throw new FormulaFail("too_complex", `The formula is nested too deeply (more than ${MAX_FORMULA_DEPTH} levels) ${at(pos)}.`, pos);
    }
  }
  private leave(): void { this.depth--; }

  parse(): Node {
    const node = this.parseOr();
    const t = this.peek();
    if (t.k !== "eof") throw new FormulaFail("syntax", `Unexpected ${describe(t)} ${at(t.pos)}.`, t.pos);
    return node;
  }

  private isKeyword(t: Token, word: string): boolean { return t.k === "id" && t.name === word; }

  private parseOr(): Node {
    this.enter(this.peek().pos);
    let left = this.parseAnd();
    while (this.isKeyword(this.peek(), "or")) {
      const op = this.next();
      const right = this.parseAnd();
      this.count(op.pos);
      left = { t: "bin", op: "or", l: left, r: right, pos: op.pos };
    }
    this.leave();
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.isKeyword(this.peek(), "and")) {
      const op = this.next();
      const right = this.parseNot();
      this.count(op.pos);
      left = { t: "bin", op: "and", l: left, r: right, pos: op.pos };
    }
    return left;
  }

  private parseNot(): Node {
    const t = this.peek();
    if (this.isKeyword(t, "not")) {
      this.next();
      this.enter(t.pos);
      const arg = this.parseNot();
      this.leave();
      this.count(t.pos);
      return { t: "unary", op: "not", arg, pos: t.pos };
    }
    return this.parseComparison();
  }

  private parseComparison(): Node {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t.k === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(t.op)) {
      this.next();
      const right = this.parseAdditive();
      const after = this.peek();
      if (after.k === "op" && ["<", "<=", ">", ">=", "==", "!="].includes(after.op)) {
        throw new FormulaFail("syntax", `Comparisons cannot be chained ${at(after.pos)}. Join them with "and", e.g. a < b and b < c.`, after.pos);
      }
      this.count(t.pos);
      return { t: "bin", op: t.op as BinaryOp, l: left, r: right, pos: t.pos };
    }
    return left;
  }

  private parseAdditive(): Node {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t.k === "op" && (t.op === "+" || t.op === "-")) {
        this.next();
        const right = this.parseTerm();
        this.count(t.pos);
        left = { t: "bin", op: t.op, l: left, r: right, pos: t.pos };
      } else return left;
    }
  }

  private parseTerm(): Node {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.k === "op" && (t.op === "*" || t.op === "/")) {
        this.next();
        const right = this.parseUnary();
        this.count(t.pos);
        left = { t: "bin", op: t.op, l: left, r: right, pos: t.pos };
      } else return left;
    }
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.k === "op" && (t.op === "-" || t.op === "+")) {
      this.next();
      this.enter(t.pos);
      const arg = this.parseUnary();
      this.leave();
      this.count(t.pos);
      return { t: "unary", op: t.op, arg, pos: t.pos };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const t = this.next();
    switch (t.k) {
      case "num":
        this.count(t.pos);
        return { t: "num", v: t.v, pos: t.pos };
      case "lp": {
        this.enter(t.pos);
        const inner = this.parseOr();
        const close = this.next();
        if (close.k !== "rp") {
          throw new FormulaFail("syntax", `Missing ")" to close the "(" ${at(t.pos)}.`, t.pos);
        }
        this.leave();
        return inner;
      }
      case "id": {
        if (KEYWORDS.has(t.name)) {
          throw new FormulaFail("syntax", `"${t.name}" is a reserved word and cannot be used here ${at(t.pos)}.`, t.pos);
        }
        if (this.peek().k === "lp") return this.parseCall(t);
        this.count(t.pos);
        return { t: "id", name: t.name, pos: t.pos };
      }
      case "eof":
        throw new FormulaFail("syntax", `The formula ends unexpectedly ${at(t.pos)}; a value is missing.`, t.pos);
      default:
        throw new FormulaFail("syntax", `Unexpected ${describe(t)} ${at(t.pos)}.`, t.pos);
    }
  }

  private parseCall(nameTok: Extract<Token, { k: "id" }>): Node {
    const spec = Object.prototype.hasOwnProperty.call(FUNCTIONS, nameTok.name) ? FUNCTIONS[nameTok.name] : undefined;
    if (!spec) {
      throw new FormulaFail(
        "unknown_function",
        `Unknown function "${nameTok.name}" ${at(nameTok.pos)}. Available: ${FORMULA_FUNCTIONS.join(", ")}.`,
        nameTok.pos
      );
    }
    this.next(); // "("
    this.enter(nameTok.pos);
    const args: Node[] = [];
    if (this.peek().k === "rp") {
      this.next();
    } else {
      for (;;) {
        args.push(this.parseOr());
        const t = this.next();
        if (t.k === "comma") continue;
        if (t.k === "rp") break;
        throw new FormulaFail("syntax", `Expected "," or ")" in ${nameTok.name}(...) ${at(t.pos)}.`, t.pos);
      }
    }
    this.leave();
    if (args.length < spec.min || args.length > spec.max) {
      const want = spec.min === spec.max ? `${spec.min}` : `${spec.min} to ${spec.max}`;
      throw new FormulaFail("arity", `${nameTok.name}() takes ${want} argument${spec.max === 1 ? "" : "s"}, got ${args.length} ${at(nameTok.pos)}.`, nameTok.pos);
    }
    this.count(nameTok.pos);
    return { t: "call", fn: nameTok.name, args, pos: nameTok.pos };
  }
}

function describe(t: Token): string {
  switch (t.k) {
    case "num": return `number ${t.text}`;
    case "id": return `"${t.name}"`;
    case "op": return `"${t.op}"`;
    case "lp": return `"("`;
    case "rp": return `")"`;
    case "comma": return `","`;
    case "eof": return "end of formula";
  }
}

// ── Public API: parse ────────────────────────────────────────────────────────

export type ParseResult = { ok: true; ast: FormulaAst } | { ok: false; error: FormulaError };

export function parseFormula(src: string): ParseResult {
  if (typeof src !== "string") {
    return { ok: false, error: { code: "syntax", message: "A formula must be text.", position: 0 } };
  }
  if (src.trim() === "") {
    return { ok: false, error: { code: "empty", message: "The formula is empty.", position: 0 } };
  }
  if (src.length > MAX_FORMULA_LENGTH) {
    return {
      ok: false,
      error: { code: "too_long", message: `The formula is ${src.length} characters long; the limit is ${MAX_FORMULA_LENGTH}.`, position: MAX_FORMULA_LENGTH },
    };
  }
  try {
    return { ok: true, ast: new Parser(tokenize(src)).parse() };
  } catch (e) {
    if (e instanceof FormulaFail) return { ok: false, error: e.toError() };
    throw e;
  }
}

// ── Identifiers ──────────────────────────────────────────────────────────────

/** Every identifier a parsed formula reads, with the position of its first use. */
export function formulaIdentifiers(ast: FormulaAst): { name: string; position: number }[] {
  const seen = new Map<string, number>();
  const walk = (n: Node): void => {
    switch (n.t) {
      case "id": if (!seen.has(n.name)) seen.set(n.name, n.pos); return;
      case "unary": walk(n.arg); return;
      case "bin": walk(n.l); walk(n.r); return;
      case "call": n.args.forEach(walk); return;
      case "num": return;
    }
  };
  walk(ast);
  return [...seen].map(([name, position]) => ({ name, position }));
}

export type FormulaValidation = {
  ok: boolean;
  errors: FormulaError[];
  /** Identifiers the formula reads (empty when it does not parse). */
  identifiers: string[];
  /** The subset not present in `knownIdentifiers`. */
  unknownIdentifiers: string[];
};

/** Does `src` parse, and does it only read names in `knownIdentifiers`? */
export function validateFormula(src: string, knownIdentifiers: Iterable<string>): FormulaValidation {
  const parsed = parseFormula(src);
  if (!parsed.ok) return { ok: false, errors: [parsed.error], identifiers: [], unknownIdentifiers: [] };
  const known = new Set(knownIdentifiers);
  const ids = formulaIdentifiers(parsed.ast);
  const unknown = ids.filter((i) => !known.has(i.name));
  return {
    ok: unknown.length === 0,
    errors: unknown.map((u) => ({
      code: "unknown_identifier" as const,
      message: `Unknown name "${u.name}" ${at(u.position)}.`,
      position: u.position,
    })),
    identifiers: ids.map((i) => i.name),
    unknownIdentifiers: unknown.map((u) => u.name),
  };
}

// ── Evaluator ────────────────────────────────────────────────────────────────

export type FormulaScope = Readonly<Record<string, number>> | ReadonlyMap<string, number>;

export type EvalOptions = { maxSteps?: number };

function lookup(scope: FormulaScope, name: string): number | undefined {
  if (scope instanceof Map) return scope.get(name);
  const rec = scope as Readonly<Record<string, number>>;
  return Object.prototype.hasOwnProperty.call(rec, name) ? rec[name] : undefined;
}

const truthy = (v: number): boolean => v !== 0;

function evalNode(n: Node, scope: FormulaScope, budget: { left: number }): number {
  if (--budget.left < 0) {
    throw new FormulaFail("step_limit", `The formula took too many steps to evaluate ${at(n.pos)}.`, n.pos);
  }
  switch (n.t) {
    case "num": return n.v;
    case "id": {
      const v = lookup(scope, n.name);
      if (v === undefined || typeof v !== "number") {
        throw new FormulaFail("unknown_identifier", `Unknown name "${n.name}" ${at(n.pos)}.`, n.pos);
      }
      if (!Number.isFinite(v)) {
        throw new FormulaFail("not_finite", `"${n.name}" is not a usable number ${at(n.pos)}.`, n.pos);
      }
      return v;
    }
    case "unary": {
      const a = evalNode(n.arg, scope, budget);
      if (n.op === "not") return truthy(a) ? 0 : 1;
      return n.op === "-" ? (a === 0 ? 0 : -a) : a;
    }
    case "bin": {
      if (n.op === "and") {
        const l = evalNode(n.l, scope, budget);
        return truthy(l) && truthy(evalNode(n.r, scope, budget)) ? 1 : 0;
      }
      if (n.op === "or") {
        const l = evalNode(n.l, scope, budget);
        return truthy(l) || truthy(evalNode(n.r, scope, budget)) ? 1 : 0;
      }
      const l = evalNode(n.l, scope, budget);
      const r = evalNode(n.r, scope, budget);
      let v: number;
      switch (n.op) {
        case "+": v = l + r; break;
        case "-": v = l - r; break;
        case "*": v = l * r; break;
        case "/":
          if (r === 0) throw new FormulaFail("divide_by_zero", `Division by zero ${at(n.pos)}.`, n.pos);
          v = l / r;
          break;
        case "<": return l < r ? 1 : 0;
        case "<=": return l <= r ? 1 : 0;
        case ">": return l > r ? 1 : 0;
        case ">=": return l >= r ? 1 : 0;
        case "==": return l === r ? 1 : 0;
        default: return l !== r ? 1 : 0; // "!="
      }
      if (!Number.isFinite(v)) throw new FormulaFail("not_finite", `The result is too large to represent ${at(n.pos)}.`, n.pos);
      return v === 0 ? 0 : v; // normalise -0
    }
    case "call": {
      if (n.fn === "if") {
        // Only the chosen branch is evaluated.
        return truthy(evalNode(n.args[0], scope, budget))
          ? evalNode(n.args[1], scope, budget)
          : evalNode(n.args[2], scope, budget);
      }
      const args = n.args.map((a) => evalNode(a, scope, budget));
      switch (n.fn) {
        case "ceil": return Math.ceil(args[0]) || 0;
        case "floor": return Math.floor(args[0]) || 0;
        case "abs": return Math.abs(args[0]);
        case "min": return Math.min(...args);
        case "max": return Math.max(...args);
        case "round": {
          const dp = args.length === 2 ? args[1] : 0;
          if (!Number.isInteger(dp) || dp < 0 || dp > 10) {
            throw new FormulaFail("invalid_argument", `round() decimals must be a whole number from 0 to 10 ${at(n.pos)}.`, n.pos);
          }
          return roundHalfAway(args[0], dp) || 0;
        }
        default:
          throw new FormulaFail("unknown_function", `Unknown function "${n.fn}" ${at(n.pos)}.`, n.pos);
      }
    }
  }
}

/** Evaluate an already-parsed formula. */
export function evaluateAst(ast: FormulaAst, scope: FormulaScope, opts: EvalOptions = {}): FormulaResult {
  try {
    const value = evalNode(ast, scope, { left: opts.maxSteps ?? MAX_EVAL_STEPS });
    if (!Number.isFinite(value)) {
      return { ok: false, error: { code: "not_finite", message: "The result is not a finite number.", position: 0 } };
    }
    return { ok: true, value };
  } catch (e) {
    if (e instanceof FormulaFail) return { ok: false, error: e.toError() };
    throw e;
  }
}

/** Parse and evaluate in one step. */
export function evaluateFormula(src: string, scope: FormulaScope, opts: EvalOptions = {}): FormulaResult {
  const parsed = parseFormula(src);
  if (!parsed.ok) return parsed;
  return evaluateAst(parsed.ast, scope, opts);
}
