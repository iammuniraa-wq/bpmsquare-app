import { describe, expect, it } from "vitest";
import { matchAccountId } from "./service";
import type { AnalysisAccess } from "./service";

const rows = (list: { id: string; name: string; website?: string | null }[]) => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: list.map((r) => ({ website: null, ...r })), error: null }) }) }) }) },
  tenantId: "t1",
}) as unknown as AnalysisAccess;

describe("a company typed by name that is already an account", () => {
  const a = rows([{ id: "a1", name: "ABB India Limited" }, { id: "a2", name: "Najd Precast Co.", website: "https://www.najdprecast.com" }]);
  it("is that account: legal words and case do not matter", async () => {
    expect(await matchAccountId(a, { name: "abb india" })).toBe("a1");
    expect(await matchAccountId(a, { name: "ABB INDIA LTD" })).toBe("a1");
  });
  it("matches on the website too", async () => {
    expect(await matchAccountId(a, { name: "Najd", domain: "najdprecast.com" })).toBe("a2");
  });
  it("is not matched when the name only partly overlaps, or nothing is typed", async () => {
    expect(await matchAccountId(a, { name: "abb" })).toBeNull();
    expect(await matchAccountId(a, {})).toBeNull();
  });
  it("is left alone when two accounts share the name", async () => {
    const two = rows([{ id: "a1", name: "ABB India" }, { id: "a3", name: "ABB India Ltd" }]);
    expect(await matchAccountId(two, { name: "abb india" })).toBeNull();
  });
});
