import { describe, it, expect } from "vitest";
import {
  depthOf, canNest, descendantsOf, rollUp, reparentError,
  nextChildRef, MAX_DEPTH, MAX_LEVEL, type TreeNodeLike,
} from "./projectTree";

const n = (id: string, parent_id: string | null = null): TreeNodeLike => ({ id, parent_id });

// project -> wbs -> task
const tree: TreeNodeLike[] = [
  n("p"), n("w1", "p"), n("w2", "p"), n("t1", "w1"), n("other"),
];
const byId = new Map(tree.map((x) => [x.id, x]));

describe("depthOf", () => {
  it("counts from the root", () => {
    expect(depthOf(byId, "p")).toBe(0);
    expect(depthOf(byId, "w1")).toBe(1);
    expect(depthOf(byId, "t1")).toBe(2);
  });

  it("returns null on a broken chain rather than guessing", () => {
    expect(depthOf(new Map([["orphan", n("orphan", "missing")]]), "orphan")).toBeNull();
  });

  it("returns null on a cycle rather than looping forever", () => {
    const cyclic = new Map([["a", n("a", "b")], ["b", n("b", "a")]]);
    expect(depthOf(cyclic, "a")).toBeNull();
  });
});

describe("nextChildRef", () => {
  it("numbers parts inside the parent, not from the PRJ sequence", () => {
    expect(nextChildRef("PRJ-0003", [])).toBe("PRJ-0003.1");
    expect(nextChildRef("PRJ-0003", ["PRJ-0003.1"])).toBe("PRJ-0003.2");
  });

  it("nests a level down", () => {
    expect(nextChildRef("PRJ-0003.1", ["PRJ-0003.1.1"])).toBe("PRJ-0003.1.2");
  });

  // The dot in a parent ref is a regex metacharacter -- unescaped,
  // "PRJ-0003.1" would also match "PRJ-0003X1" and misread the siblings.
  it("treats the parent ref as text, not a pattern", () => {
    expect(nextChildRef("PRJ-0003.1", ["PRJ-0003X1.7"])).toBe("PRJ-0003.1.1");
  });

  // A LIKE 'PRJ-0003.%' sweep also returns grandchildren; only direct
  // children may set the next number.
  it("ignores deeper descendants and unrelated refs", () => {
    expect(nextChildRef("PRJ-0003", ["PRJ-0003.1", "PRJ-0003.1.9", "PRJ-0004.5", null])).toBe("PRJ-0003.2");
  });

  // Highest wins, not the count -- otherwise deleting .2 of three parts
  // reissues .3 to a different part and two rows share a ref.
  it("takes the highest suffix so a deleted number is never reused", () => {
    expect(nextChildRef("PRJ-0003", ["PRJ-0003.1", "PRJ-0003.3"])).toBe("PRJ-0003.4");
  });
});

describe("canNest", () => {
  // Level 0 is the main project, so the cap allows Levels 1..MAX_LEVEL.
  it("allows every sub-project level the spec defines", () => {
    expect(MAX_LEVEL).toBe(3);
    expect(canNest(MAX_LEVEL - 1)).toBe(true);
  });

  it("allows nesting until the cap", () => {
    expect(canNest(0)).toBe(true);
    expect(canNest(MAX_DEPTH - 2)).toBe(true);
  });

  it("stops at the cap — this is what hides the Add link", () => {
    expect(canNest(MAX_DEPTH - 1)).toBe(false);
  });
});

describe("descendantsOf", () => {
  it("collects the whole subtree, not just direct children", () => {
    expect(descendantsOf(tree, "p").sort()).toEqual(["t1", "w1", "w2"]);
  });

  it("is empty for a leaf", () => {
    expect(descendantsOf(tree, "t1")).toEqual([]);
  });

  it("does not hang on a cycle", () => {
    const cyclic = [n("a", "b"), n("b", "a")];
    expect(descendantsOf(cyclic, "a").length).toBeLessThanOrEqual(2);
  });
});

describe("rollUp", () => {
  it("adds a leaf's hours to every ancestor", () => {
    const out = rollUp(tree, new Map([["t1", 120]]));
    expect(out.get("t1")).toEqual({ own: 120, total: 120 });
    expect(out.get("w1")).toEqual({ own: 0, total: 120 });
    expect(out.get("p")).toEqual({ own: 0, total: 120 });
  });

  it("keeps own and total apart when a parent has hours of its own", () => {
    const out = rollUp(tree, new Map([["p", 60], ["t1", 120]]));
    expect(out.get("p")).toEqual({ own: 60, total: 180 });
  });

  it("sums siblings into the shared parent", () => {
    const out = rollUp(tree, new Map([["w1", 30], ["w2", 45]]));
    expect(out.get("p")?.total).toBe(75);
  });

  it("leaves an unrelated root alone", () => {
    const out = rollUp(tree, new Map([["t1", 120]]));
    expect(out.get("other")).toEqual({ own: 0, total: 0 });
  });
});

describe("reparentError", () => {
  it("allows a legal move", () => {
    expect(reparentError(tree, "w2", "w1")).toBeNull();
  });

  it("refuses making something its own parent", () => {
    expect(reparentError(tree, "p", "p")).toMatch(/its own parent/);
  });

  it("refuses a loop through a descendant", () => {
    expect(reparentError(tree, "p", "t1")).toMatch(/inside one of its own/);
  });

  it("refuses going deeper than the cap", () => {
    // A chain already at the deepest level cannot take another child.
    const deep: TreeNodeLike[] = [n("a")];
    for (let i = 1; i < MAX_DEPTH; i++) deep.push(n(`a${i}`, i === 1 ? "a" : `a${i - 1}`));
    const leaf = `a${MAX_DEPTH - 1}`;
    expect(reparentError([...deep, n("x")], "x", leaf)).toMatch(/deepest level/);
  });

  // Moving a branch takes its children along; checking only the node itself
  // would let a deep subtree land somewhere with no room for it.
  it("refuses a move whose SUBTREE would overflow, even though the node fits", () => {
    const deep: TreeNodeLike[] = [n("a")];
    for (let i = 1; i < MAX_DEPTH - 1; i++) deep.push(n(`a${i}`, i === 1 ? "a" : `a${i - 1}`));
    // "branch" is 2 deep on its own; parking it near the bottom overflows.
    const withBranch = [...deep, n("branch"), n("bc", "branch"), n("bcc", "bc")];
    expect(reparentError(withBranch, "branch", `a${MAX_DEPTH - 2}`)).toMatch(/deeper than allowed/);
  });

  it("allows clearing the parent", () => {
    expect(reparentError(tree, "w1", null)).toBeNull();
  });
});
