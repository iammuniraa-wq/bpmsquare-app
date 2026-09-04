import { describe, it, expect } from "vitest";
import {
  depthOf, childLevelName, levelNameOf, descendantsOf, rollUp, reparentError,
  type TreeNodeLike,
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

describe("level naming comes from the tenant, not from us", () => {
  it("offers the next level's name while one remains", () => {
    expect(childLevelName(["WBS"], 0)).toBe("WBS");
    expect(childLevelName(["Phase", "Task"], 1)).toBe("Task");
  });

  it("offers nothing at the deepest level — this is what hides the Add button", () => {
    expect(childLevelName(["WBS"], 1)).toBeNull();
    expect(childLevelName([], 0)).toBeNull();
  });

  it("names a node by its own depth", () => {
    expect(levelNameOf(["WBS"], 0)).toBe("Project");
    expect(levelNameOf(["WBS"], 1)).toBe("WBS");
    expect(levelNameOf(["Phase", "Task"], 2)).toBe("Task");
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
    expect(reparentError(tree, ["WBS", "Task"], "w2", "w1")).toBeNull();
  });

  it("refuses making something its own parent", () => {
    expect(reparentError(tree, ["WBS"], "p", "p")).toMatch(/its own parent/);
  });

  it("refuses a loop through a descendant", () => {
    expect(reparentError(tree, ["WBS", "Task"], "p", "t1")).toMatch(/inside one of its own/);
  });

  it("refuses going deeper than the tenant allows", () => {
    // Only one level configured, so a WBS cannot itself take a child.
    expect(reparentError(tree, ["WBS"], "w2", "w1")).toMatch(/deepest level/);
  });

  it("explains it clearly when hierarchy is switched off entirely", () => {
    expect(reparentError(tree, [], "w1", "p")).toMatch(/aren't switched on/);
  });

  // Moving a branch takes its children along; checking only the node itself
  // would let a deep subtree land somewhere with no room for it.
  it("refuses a move whose SUBTREE would overflow, even though the node fits", () => {
    expect(reparentError(tree, ["Phase", "Task"], "w1", "w2")).toMatch(/sub-items would go deeper/);
  });

  it("allows clearing the parent", () => {
    expect(reparentError(tree, ["WBS"], "w1", null)).toBeNull();
  });
});
