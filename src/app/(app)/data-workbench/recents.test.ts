import { describe, expect, it } from "vitest";
import { RECENTS_MAX, browserStorage, ownedRecents, pushRecent, readRecents, recentsKey, touchRecent, writeRecents } from "./recents";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => { data[k] = v; } };
}

describe("recents", () => {
  it("puts the newest first and never repeats an object", () => {
    expect(pushRecent(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(pushRecent([], "x")).toEqual(["x"]);
  });

  it("keeps five", () => {
    let list: string[] = [];
    for (const id of ["a", "b", "c", "d", "e", "f", "g"]) list = pushRecent(list, id);
    expect(list).toEqual(["g", "f", "e", "d", "c"]);
    expect(list).toHaveLength(RECENTS_MAX);
  });

  it("is kept per workspace and per person", () => {
    expect(recentsKey("t1", "u1")).toBe("dw-recents:t1:u1");
    expect(recentsKey("t1", "u1")).not.toBe(recentsKey("t2", "u1"));
    expect(recentsKey("t1", "u1")).not.toBe(recentsKey("t1", "u2"));
    const s = memory();
    touchRecent(s, recentsKey("t1", "u1"), "accounts");
    touchRecent(s, recentsKey("t2", "u1"), "cases");
    expect(readRecents(s, recentsKey("t1", "u1"))).toEqual(["accounts"]);
    expect(readRecents(s, recentsKey("t2", "u1"))).toEqual(["cases"]);
    expect(readRecents(s, recentsKey("t1", "u2"))).toEqual([]);
  });

  it("touch reads, moves to the front, writes back and returns the list", () => {
    const s = memory();
    const key = recentsKey("t", "u");
    touchRecent(s, key, "accounts");
    touchRecent(s, key, "contacts");
    expect(touchRecent(s, key, "accounts")).toEqual(["accounts", "contacts"]);
    expect(JSON.parse(s.data[key])).toEqual(["accounts", "contacts"]);
  });

  it("tolerates storage that is missing, throws or holds something else", () => {
    expect(readRecents(null, "k")).toEqual([]);
    expect(readRecents(undefined, "k")).toEqual([]);
    expect(readRecents({ getItem: () => { throw new Error("denied"); } }, "k")).toEqual([]);
    expect(readRecents(memory({ k: "not json" }), "k")).toEqual([]);
    expect(readRecents(memory({ k: '{"a":1}' }), "k")).toEqual([]);
    expect(readRecents(memory({ k: '["a",1,null,"a","b",""]' }), "k")).toEqual(["a", "b"]);
    expect(() => writeRecents({ setItem: () => { throw new Error("quota"); } }, "k", ["a"])).not.toThrow();
    expect(() => writeRecents(null, "k", ["a"])).not.toThrow();
    expect(touchRecent({ getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("y"); } }, "k", "a")).toEqual(["a"]);
    expect(browserStorage()).toBeNull(); // node: no window
  });

  it("drops an object the workspace no longer owns without losing the order of the rest", () => {
    expect(ownedRecents(["cases", "accounts", "contacts"], new Set(["accounts", "contacts"]))).toEqual(["accounts", "contacts"]);
  });
});
