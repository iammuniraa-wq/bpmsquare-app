// Pratt parser for the PricingEngine formula DSL (spec §5, grammar v1).
// Custom parser over CEL by decision (spec §14.2): the grammar is small, and
// owning the parser means owning the evaluation budget completely. Closed AST,
// no eval, ever.

import { DslError, FUNCTIONS, LIMITS, type BinaryOp, type Node } from "./ast";

type Token =
  | { t: "num"; v: number; pos: number }
  | { t: "str"; v: string; pos: number }
  | { t: "ident"; v: string; pos: number }
  | { t: "op"; v: string; pos: number }
  | { t: "eof"; pos: number };

const TWO_CHAR_OPS = new Set(["<=", ">=", "==", "!=", "&&", "||"]);
const ONE_CHAR_OPS = new Set(["+", "-", "*", "/", "%", "<", ">", "!", "?", ":", "(", ")", ",", "."]);

function tokenize(src: string): Token[] {
  if (src.length > LIMITS.maxFormulaLength) {
    throw new DslError(`Formula exceeds ${LIMITS.maxFormulaLength} characters`, 0);
  }
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "#") { // comment to end of line
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c >= "0" && c <= "9") {
      const start = i;
      while (i < src.length && ((src[i] >= "0" && src[i] <= "9") || src[i] === ".")) i++;
      const raw = src.slice(start, i);
      const num = Number(raw);
      if (!Number.isFinite(num)) throw new DslError(`Invalid number "${raw}"`, start);
      tokens.push({ t: "num", v: num, pos: start });
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      const start = i;
      i++;
      let out = "";
      while (i < src.length && src[i] !== quote) {
        out += src[i];
        i++;
      }
      if (i >= src.length) throw new DslError("Unterminated string", start);
      i++; // closing quote
      tokens.push({ t: "str", v: out, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++;
      tokens.push({ t: "ident", v: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (TWO_CHAR_OPS.has(two)) {
      tokens.push({ t: "op", v: two, pos: i });
      i += 2;
      continue;
    }
    if (ONE_CHAR_OPS.has(c)) {
      tokens.push({ t: "op", v: c, pos: i });
      i++;
      continue;
    }
    throw new DslError(`Unexpected character "${c}"`, i);
  }
  tokens.push({ t: "eof", pos: src.length });
  return tokens;
}

// Binding powers, low → high. Ternary sits below || (right-associative).
const BINARY_BP: Record<string, number> = {
  "||": 20, "&&": 30,
  "==": 40, "!=": 40,
  "<": 50, "<=": 50, ">": 50, ">=": 50,
  "+": 60, "-": 60,
  "*": 70, "/": 70, "%": 70,
};
const TERNARY_BP = 10;

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.i]; }
  private next(): Token { return this.tokens[this.i++]; }

  private expectOp(v: string): void {
    const tok = this.next();
    if (tok.t !== "op" || tok.v !== v) {
      throw new DslError(`Expected "${v}"`, tok.pos);
    }
  }

  parseExpression(minBp = 0, depth = 0): Node {
    if (depth > LIMITS.maxAstDepth) {
      throw new DslError(`Formula nesting exceeds depth ${LIMITS.maxAstDepth}`, this.peek().pos);
    }
    let left = this.parsePrefix(depth);

    for (;;) {
      const tok = this.peek();
      if (tok.t !== "op") break;

      if (tok.v === "?" && TERNARY_BP >= minBp) {
        this.next();
        const thenBranch = this.parseExpression(0, depth + 1);
        this.expectOp(":");
        const elseBranch = this.parseExpression(TERNARY_BP, depth + 1);
        left = { kind: "ternary", cond: left, then: thenBranch, else: elseBranch };
        continue;
      }

      const bp = BINARY_BP[tok.v];
      if (bp === undefined || bp <= minBp) break;
      this.next();
      const right = this.parseExpression(bp, depth + 1);
      left = { kind: "binary", op: tok.v as BinaryOp, left, right };
    }
    return left;
  }

  private parsePrefix(depth: number): Node {
    const tok = this.next();

    if (tok.t === "num") return { kind: "num", value: tok.v };
    if (tok.t === "str") return { kind: "str", value: tok.v };

    if (tok.t === "op") {
      if (tok.v === "(") {
        const inner = this.parseExpression(0, depth + 1);
        this.expectOp(")");
        return inner;
      }
      if (tok.v === "-") {
        return { kind: "unary", op: "-", operand: this.parseExpression(80, depth + 1) };
      }
      if (tok.v === "!") {
        return { kind: "unary", op: "!", operand: this.parseExpression(80, depth + 1) };
      }
      throw new DslError(`Unexpected "${tok.v}"`, tok.pos);
    }

    if (tok.t === "ident") {
      if (tok.v === "true") return { kind: "bool", value: true };
      if (tok.v === "false") return { kind: "bool", value: false };
      if (tok.v === "null") return { kind: "null" };

      // ctx.<path> accessor
      if (tok.v === "ctx") {
        const path: string[] = [];
        while (this.peek().t === "op" && (this.peek() as { v: string }).v === ".") {
          this.next();
          const seg = this.next();
          if (seg.t !== "ident") throw new DslError("Expected identifier after '.'", seg.pos);
          // Dunder segments could walk the prototype chain in a careless
          // evaluator; reject at parse time so they can never be stored.
          if (seg.v.startsWith("__") || seg.v === "constructor" || seg.v === "prototype") {
            throw new DslError(`Illegal path segment "${seg.v}"`, seg.pos);
          }
          path.push(seg.v);
        }
        if (path.length === 0) throw new DslError("ctx requires a path (e.g. ctx.line.quantity)", tok.pos);
        return { kind: "ctx", path };
      }

      // function call
      if (this.peek().t === "op" && (this.peek() as { v: string }).v === "(") {
        if (!FUNCTIONS.has(tok.v)) {
          throw new DslError(`Unknown function "${tok.v}"`, tok.pos);
        }
        this.next(); // consume "("
        const args: Node[] = [];
        if (!(this.peek().t === "op" && (this.peek() as { v: string }).v === ")")) {
          for (;;) {
            args.push(this.parseExpression(0, depth + 1));
            const sep = this.peek();
            if (sep.t === "op" && sep.v === ",") { this.next(); continue; }
            break;
          }
        }
        this.expectOp(")");
        return { kind: "call", name: tok.v, args };
      }

      throw new DslError(`Unknown identifier "${tok.v}" (bare identifiers are not allowed; use ctx.<path> or a function)`, tok.pos);
    }

    throw new DslError("Unexpected end of formula", tok.pos);
  }

  assertDone(): void {
    const tok = this.peek();
    if (tok.t !== "eof") {
      throw new DslError(`Unexpected trailing input`, tok.pos);
    }
  }
}

/** Parse a formula into a closed AST. Throws DslError with a position on any invalid input. */
export function parseFormula(src: string): Node {
  const parser = new Parser(tokenize(src));
  const node = parser.parseExpression();
  parser.assertDone();
  return node;
}
