import { describe, it, expect } from "vitest";
import { effectiveSelfService } from "./selfService";

describe("effectiveSelfService", () => {
  it.each([
    [true, null, true],
    [true, true, true],
    [true, false, false],
    [false, null, false],
    [false, true, true],
    [false, false, false],
  ] as const)("workspace %s, override %s -> %s", (workspace, override, expected) => {
    expect(effectiveSelfService(override, workspace)).toBe(expected);
  });

  it("treats a missing column (undefined) as inherit", () => {
    expect(effectiveSelfService(undefined, true)).toBe(true);
    expect(effectiveSelfService(undefined, false)).toBe(false);
  });
});
