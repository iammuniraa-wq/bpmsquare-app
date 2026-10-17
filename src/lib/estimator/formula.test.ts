import { describe, it, expect } from "vitest";
import {
  evaluateFormula, parseFormula, validateFormula, roundHalfAway,
  MAX_FORMULA_LENGTH, MAX_FORMULA_NODES,
} from "./formula";

const ev = (src: string, scope: Record<string, number> = {}) => evaluateFormula(src, scope);
const val = (src: string, scope: Record<string, number> = {}): number => {
  const r = ev(src, scope);
  if (!r.ok) throw new Error(`${src} -> ${r.error.message}`);
  return r.value;
};
const err = (src: string, scope: Record<string, number> = {}) => {
  const r = ev(src, scope);
  if (r.ok) throw new Error(`${src} should have failed, got ${r.value}`);
  return r.error;
};

describe("arithmetic", () => {
  it("evaluates numbers and the four operators with precedence", () => {
    expect(val("1 + 2 * 3")).toBe(7);
    expect(val("(1 + 2) * 3")).toBe(9);
    expect(val("10 - 4 - 3")).toBe(3); // left associative
    expect(val("100 / 5 / 2")).toBe(10);
    expect(val("2 * 3 + 4 * 5")).toBe(26);
    expect(val("0.1 + 0.2")).toBeCloseTo(0.3, 12);
    expect(val(".5 * 4")).toBe(2);
    expect(val("5. + 1")).toBe(6);
  });

  it("supports unary minus and plus", () => {
    expect(val("-3")).toBe(-3);
    expect(val("- -3")).toBe(3);
    expect(val("-(2 + 3) * 2")).toBe(-10);
    expect(val("+4")).toBe(4);
    expect(val("2 - -3")).toBe(5);
    expect(Object.is(val("-0"), -0)).toBe(false);
  });

  it("reads identifiers from the scope", () => {
    expect(val("a * b + c", { a: 2, b: 3, c: 4 })).toBe(10);
    expect(val("qty_wall + sub_structure", { qty_wall: 5.5, sub_structure: 100 })).toBe(105.5);
  });

  it("accepts spaces, tabs and newlines between tokens", () => {
    expect(val("1\n+\t2")).toBe(3);
  });
});

describe("comparisons and logic", () => {
  it("returns 1 or 0", () => {
    expect(val("1 < 2")).toBe(1);
    expect(val("2 <= 2")).toBe(1);
    expect(val("3 > 4")).toBe(0);
    expect(val("4 >= 5")).toBe(0);
    expect(val("2 == 2")).toBe(1);
    expect(val("2 != 2")).toBe(0);
    expect(val("1 + 1 == 2")).toBe(1); // arithmetic binds tighter
  });

  it("supports and / or / not with precedence and short-circuit", () => {
    expect(val("1 and 0")).toBe(0);
    expect(val("1 or 0")).toBe(1);
    expect(val("0 or 1 and 0")).toBe(0); // and binds tighter than or
    expect(val("not 0")).toBe(1);
    expect(val("not 1 == 2")).toBe(1); // not applies to the whole comparison
    expect(val("a > 1 and a < 5", { a: 3 })).toBe(1);
    // the right side would divide by zero; it is not evaluated
    expect(val("0 and 1 / 0")).toBe(0);
    expect(val("1 or 1 / 0")).toBe(1);
  });

  it("rejects chained comparisons with advice", () => {
    const e = err("1 < 2 < 3");
    expect(e.code).toBe("syntax");
    expect(e.message).toMatch(/chained/);
  });

  it("explains a single =", () => {
    const e = err("a = 1", { a: 1 });
    expect(e.message).toMatch(/==/);
    expect(e.position).toBe(2);
  });
});

describe("functions", () => {
  it("ceil, floor, abs", () => {
    expect(val("ceil(2.1)")).toBe(3);
    expect(val("ceil(-2.1)")).toBe(-2);
    expect(val("floor(2.9)")).toBe(2);
    expect(val("floor(-2.1)")).toBe(-3);
    expect(val("abs(-7.5)")).toBe(7.5);
    expect(Object.is(val("ceil(-0.4)"), -0)).toBe(false);
  });

  it("round(x) and round(x, n) round half away from zero", () => {
    expect(val("round(2.5)")).toBe(3);
    expect(val("round(-2.5)")).toBe(-3);
    expect(val("round(1.005, 2)")).toBe(1.01);
    expect(val("round(2.675, 2)")).toBe(2.68);
    expect(val("round(3.14159, 3)")).toBe(3.142);
  });

  it("round rejects bad decimals", () => {
    expect(err("round(1.5, 1.5)").code).toBe("invalid_argument");
    expect(err("round(1.5, -1)").code).toBe("invalid_argument");
    expect(err("round(1.5, 11)").code).toBe("invalid_argument");
  });

  it("min and max take one or more arguments", () => {
    expect(val("min(3, 1, 2)")).toBe(1);
    expect(val("max(3, 1, 2)")).toBe(3);
    expect(val("max(4)")).toBe(4);
    expect(val("max(0, a - 10)", { a: 4 })).toBe(0);
  });

  it("if evaluates only the chosen branch", () => {
    expect(val("if(1, 10, 20)")).toBe(10);
    expect(val("if(0, 10, 20)")).toBe(20);
    expect(val("if(x == 0, 0, 100 / x)", { x: 0 })).toBe(0);
    expect(val("if(x == 0, 0, 100 / x)", { x: 4 })).toBe(25);
    expect(val("if(a > 1, if(a > 2, 3, 2), 1)", { a: 2 })).toBe(2);
  });

  it("checks argument counts at parse time", () => {
    expect(err("ceil()").code).toBe("arity");
    expect(err("ceil(1, 2)").code).toBe("arity");
    expect(err("if(1, 2)").code).toBe("arity");
    expect(err("round(1, 2, 3)").code).toBe("arity");
    expect(parseFormula("min()").ok).toBe(false);
  });

  it("rejects unknown functions, including prototype names", () => {
    const e = err("sqrt(4)");
    expect(e.code).toBe("unknown_function");
    expect(e.message).toMatch(/Available:/);
    expect(err("constructor(1)").code).toBe("unknown_function");
    expect(err("toString()").code).toBe("unknown_function");
  });
});

describe("errors carry a position", () => {
  it("reports unknown identifiers", () => {
    const e = err("a + nope", { a: 1 });
    expect(e.code).toBe("unknown_identifier");
    expect(e.position).toBe(4);
    expect(e.message).toContain("nope");
    expect(e.message).toContain("position 5");
  });

  it("reports syntax problems", () => {
    expect(err("1 +").message).toMatch(/ends unexpectedly/);
    expect(err("(1 + 2").message).toMatch(/Missing "\)"/);
    expect(err("1 + 2)").message).toMatch(/Unexpected "\)"/);
    expect(err("1 2").message).toMatch(/Unexpected number 2/);
    expect(err("2x").message).toMatch(/Use \*/);
    expect(err("1 @ 2").position).toBe(2);
    expect(err("a !b", { a: 1, b: 1 }).message).toMatch(/!=/);
    expect(err("max(1 2)").message).toMatch(/Expected ","/);
    expect(err("and 1").message).toMatch(/reserved/);
    expect(err("1 + not").code).toBe("syntax");
  });

  it("reports an empty formula", () => {
    expect(err("").code).toBe("empty");
    expect(err("   ").code).toBe("empty");
  });
});

describe("numeric safety", () => {
  it("divide by zero is an error, never Infinity or NaN", () => {
    const e = err("1 / 0");
    expect(e.code).toBe("divide_by_zero");
    expect(e.position).toBe(2);
    expect(err("a / (b - b)", { a: 5, b: 3 }).code).toBe("divide_by_zero");
    expect(err("0 / 0").code).toBe("divide_by_zero");
    expect(err("1 / -0").code).toBe("divide_by_zero");
  });

  it("overflow is an error", () => {
    const big = "9".repeat(400);
    expect(err(big).code).toBe("syntax"); // literal too large
    expect(err("a * a * a * a", { a: 1e100 }).code).toBe("not_finite");
  });

  it("a non-finite scope value is rejected rather than propagated", () => {
    expect(err("a + 1", { a: Number.POSITIVE_INFINITY }).code).toBe("not_finite");
    expect(err("a + 1", { a: Number.NaN }).code).toBe("not_finite");
  });

  it("never returns a non-finite value for any input in a fuzz run", () => {
    const pieces = ["1", "0", "a", "(", ")", "+", "-", "*", "/", "<", "==", "and", "or", "not", "min(", "if(", ",", "9e", ".", " "];
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let n = 0; n < 3000; n++) {
      const len = 1 + Math.floor(rnd() * 12);
      let src = "";
      for (let k = 0; k < len; k++) src += pieces[Math.floor(rnd() * pieces.length)];
      const r = evaluateFormula(src, { a: 3 });
      if (r.ok) expect(Number.isFinite(r.value)).toBe(true);
      else expect(typeof r.error.message).toBe("string");
    }
  });
});

describe("malicious and abusive input", () => {
  it("does not evaluate JavaScript", () => {
    for (const src of [
      "process.exit(1)",
      "constructor.constructor('return 1')()",
      "this",
      "globalThis",
      "require('fs')",
      "a.b",
      "a['b']",
      "a;b",
      "`1`",
      "1; 2",
      "a => a",
      "{}",
      "[1]",
      "'x'",
      '"x"',
      "1 ? 2 : 3",
      "a++",
      "a ** 2",
      "a % 2",
      "a ^ 2",
      "1e3",
      "0x10",
    ]) {
      expect(ev(src, { a: 2 }).ok, src).toBe(false);
    }
  });

  it("treats prototype property names as unknown identifiers", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "prototype"]) {
      const e = err(name, {});
      expect(e.code, name).toBe("unknown_identifier");
    }
  });

  it("rejects an over-long formula", () => {
    const src = "1" + "+1".repeat(MAX_FORMULA_LENGTH);
    const e = err(src);
    expect(e.code).toBe("too_long");
  });

  it("rejects a formula with too many parts", () => {
    const src = "1" + "+1".repeat(MAX_FORMULA_NODES / 2);
    expect(src.length).toBeLessThanOrEqual(MAX_FORMULA_LENGTH);
    expect(err(src).code).toBe("too_complex");
  });

  it("rejects deep nesting without overflowing the stack", () => {
    const deep = "(".repeat(400) + "1" + ")".repeat(400);
    expect(deep.length).toBeLessThan(MAX_FORMULA_LENGTH);
    expect(err(deep).code).toBe("too_complex");
    expect(err("-".repeat(900) + "1").code).toBe("too_complex");
    expect(err("not ".repeat(200) + "1").code).toBe("too_complex");
    expect(err("abs(".repeat(150) + "1" + ")".repeat(150)).code).toBe("too_complex");
  });

  it("enforces the evaluation step limit", () => {
    const r = evaluateFormula("1 + 2 + 3 + 4 + 5 + 6", {}, { maxSteps: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("step_limit");
    expect(evaluateFormula("1 + 2", {}, { maxSteps: 5 }).ok).toBe(true);
  });

  it("rejects non-string input safely", () => {
    // @ts-expect-error deliberately wrong type
    expect(evaluateFormula(undefined, {}).ok).toBe(false);
    // @ts-expect-error deliberately wrong type
    expect(parseFormula(42).ok).toBe(false);
  });
});

describe("validateFormula", () => {
  it("returns the unknown identifiers with positions", () => {
    const v = validateFormula("wall_length * height + extra", ["wall_length", "height"]);
    expect(v.ok).toBe(false);
    expect(v.unknownIdentifiers).toEqual(["extra"]);
    expect(v.identifiers).toEqual(["wall_length", "height", "extra"]);
    expect(v.errors[0].position).toBe(23);
  });

  it("is ok when every name is known, ignoring function names", () => {
    const v = validateFormula("ceil(a / b) + max(c, 1)", new Set(["a", "b", "c"]));
    expect(v.ok).toBe(true);
    expect(v.unknownIdentifiers).toEqual([]);
  });

  it("reports a syntax error instead of unknown names", () => {
    const v = validateFormula("a +", ["a"]);
    expect(v.ok).toBe(false);
    expect(v.errors).toHaveLength(1);
    expect(v.errors[0].code).toBe("syntax");
  });

  it("lists each unknown name once", () => {
    const v = validateFormula("x + x * y", []);
    expect(v.unknownIdentifiers).toEqual(["x", "y"]);
  });

  it("does not need the values, so it never divides by zero", () => {
    expect(validateFormula("1 / 0", []).ok).toBe(true);
  });
});

describe("roundHalfAway", () => {
  it("rounds half away from zero and handles binary representation", () => {
    expect(roundHalfAway(1.005, 2)).toBe(1.01);
    expect(roundHalfAway(-1.005, 2)).toBe(-1.01);
    expect(roundHalfAway(0.5)).toBe(1);
    expect(roundHalfAway(-0.5)).toBe(-1);
    expect(roundHalfAway(2.4999999, 0)).toBe(2);
    expect(Object.is(roundHalfAway(-0.0004, 2), -0)).toBe(false);
    expect(roundHalfAway(1234.56789, 3)).toBe(1234.568);
  });
});
