import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_WFM_CONFIG } from "@/lib/constants";

/**
 * PUT /api/settings/workforce validates each field against an explicit
 * allowlist -- deliberately, since it writes into a JSONB blob where an
 * unvalidated key would persist whatever a client sent. The cost of that
 * design is that a NEW WfmConfig key is silently dropped on save until
 * someone remembers to add a branch for it, and the failure is invisible:
 * the UI accepts the change, the request returns 200, and the setting
 * reverts on next load.
 *
 * That happened with require_location -- shipped, enabled by the client,
 * and quietly discarded on every save, so the punch gate it controls never
 * switched on.
 *
 * This reads the route's own source and asserts every key of
 * DEFAULT_WFM_CONFIG is mentioned. Testing source text is unusual, but the
 * alternative is extracting the whole validation block into a module purely
 * to make it importable, and this catches the exact mistake for ten lines.
 */
describe("workforce settings route", () => {
  it("handles every WfmConfig key", () => {
    const src = readFileSync("src/app/api/settings/workforce/route.ts", "utf8");
    const missing = Object.keys(DEFAULT_WFM_CONFIG).filter((key) => !src.includes(`body.${key}`));
    expect(missing, `WfmConfig keys with no handling in the PUT route (they will be dropped on save): ${missing.join(", ")}`).toEqual([]);
  });
});
