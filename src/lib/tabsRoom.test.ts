import { describe, expect, it } from "vitest";
import { makeRoom } from "./tabsRoom";

const tab = (href: string) => ({ href, title: href, icon: "", section: "" });
const many = (n: number) => Array.from({ length: n }, (_, i) => tab(`/p/${i}`));

describe("makeRoom", () => {
  it("changes nothing while there is room", () => {
    const tabs = many(19);
    expect(makeRoom(tabs, "/p/3", 20, "/")).toEqual({ tabs, closed: null });
  });

  it("closes the oldest tab when the strip is full", () => {
    const r = makeRoom(many(20), "/p/19", 20, "/");
    expect(r.closed?.href).toBe("/p/0");
    expect(r.tabs).toHaveLength(19);
  });

  it("never closes the page you are on or the Dashboard", () => {
    const tabs = [tab("/"), tab("/p/1"), ...many(20).slice(2)];
    expect(makeRoom(tabs, "/p/1", 20, "/").closed?.href).toBe("/p/2");
    const only = [tab("/"), tab("/p/1")];
    expect(makeRoom(only, "/p/1", 2, "/")).toEqual({ tabs: only, closed: null });
  });
});
