import { describe, it, expect, afterEach } from "vitest";
import { __setSignalsStageModuleForTest, getAbmBuyingStage, getAbmBuyingStages, normaliseStage } from "./stage";

afterEach(() => __setSignalsStageModuleForTest(undefined));

describe("buying stage adapter", () => {
  it("returns no stage when the Signals module is not there (the normal case until Signals ships)", async () => {
    __setSignalsStageModuleForTest(null);
    expect(await getAbmBuyingStage("t", "a")).toBeNull();
    const many = await getAbmBuyingStages("t", ["a", "b"]);
    expect([...many.values()]).toEqual([null, null]);
  });

  it("works with no injection at all, through the real guarded require, without throwing", async () => {
    __setSignalsStageModuleForTest(undefined);
    await expect(getAbmBuyingStage("t", "a")).resolves.toBeNull();
  });

  it("reads a plain stage or an object carrying one", async () => {
    __setSignalsStageModuleForTest({ getBuyingStage: async () => "Comparing" });
    expect(await getAbmBuyingStage("t", "a")).toBe("comparing");
    __setSignalsStageModuleForTest({ getBuyingStage: () => ({ stage: "deciding", score: 80 }) });
    expect(await getAbmBuyingStage("t", "a")).toBe("deciding");
  });

  it("treats anything it does not recognise, a missing function or a throwing module as no stage", async () => {
    __setSignalsStageModuleForTest({ getBuyingStage: async () => "hot" });
    expect(await getAbmBuyingStage("t", "a")).toBeNull();
    __setSignalsStageModuleForTest({});
    expect(await getAbmBuyingStage("t", "a")).toBeNull();
    __setSignalsStageModuleForTest({ getBuyingStage: async () => { throw new Error("boom"); } });
    expect(await getAbmBuyingStage("t", "a")).toBeNull();
    expect(normaliseStage(undefined)).toBeNull();
  });

  it("one failing account leaves only that one empty", async () => {
    __setSignalsStageModuleForTest({ getBuyingStage: async (_t: string, id: string) => { if (id === "bad") throw new Error("x"); return "looking"; } });
    const out = await getAbmBuyingStages("t", ["ok", "bad", "ok"]);
    expect(out.get("ok")).toBe("looking");
    expect(out.get("bad")).toBeNull();
  });
});
