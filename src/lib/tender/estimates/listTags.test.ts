import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";

vi.mock("server-only", () => ({}));

import { estimateTenderTags } from "./listTags";

const T1 = "00000000-0000-4000-8000-0000000000a1";
const T2 = "00000000-0000-4000-8000-0000000000a2";
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OPP_T2 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const E_TENDER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01";
const E_PLAIN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02";
const E_FOREIGN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03";

const db = () => new MemoryDb({
  estimates: [
    { id: E_TENDER, tenant_id: T1, opportunity_id: OPP },
    { id: E_PLAIN, tenant_id: T1, opportunity_id: null },
    { id: E_FOREIGN, tenant_id: T1, opportunity_id: OPP_T2 },
  ],
  opportunities: [
    { id: OPP, tenant_id: T1, ref: "OPP-0011", title: "Pump station" },
    { id: OPP_T2, tenant_id: T2, ref: "OPP-0099", title: "Theirs" },
  ],
}) as unknown as SupabaseClient & MemoryDb;

const on = { gcc_tender: true, pipeline: true };

describe("estimateTenderTags", () => {
  it("names the tender of an estimate made for one, and nothing for the rest", async () => {
    const tags = await estimateTenderTags(db(), T1, on, [E_TENDER, E_PLAIN]);
    expect(tags.get(E_TENDER)).toEqual({ id: OPP, ref: "OPP-0011", title: "Pump station" });
    expect(tags.has(E_PLAIN)).toBe(false);
  });
  it("never shows another workspace's deal", async () => {
    const tags = await estimateTenderTags(db(), T1, on, [E_FOREIGN]);
    expect(tags.size).toBe(0);
  });
  it("asks nothing without the tender edition", async () => {
    const d = db();
    const spy = vi.spyOn(d, "from");
    expect((await estimateTenderTags(d, T1, { gcc_tender: false, pipeline: true }, [E_TENDER])).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
  it("is empty while the deal column is missing", async () => {
    const d = db();
    d.missingColumns.estimates = new Set(["opportunity_id"]);
    expect((await estimateTenderTags(d, T1, on, [E_TENDER])).size).toBe(0);
  });
});
