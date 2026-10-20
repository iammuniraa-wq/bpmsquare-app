import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { TEMPLATES, TRIGGERS } from "./definition";
import { guardSummary } from "./explain";
import { DEFAULT_LIMITS } from "./safety";
import { JOURNEY_TIPS, inTroubleTip, limitsTip } from "./tips";

describe("the journey explanations behind the i", () => {
  it("every fixed one fits the InfoTip limit", () => {
    for (const [key, text] of Object.entries(JOURNEY_TIPS)) expect(tipTextProblems(text), key).toEqual([]);
  });
  it("so do the ones built from the workspace's settings and the trigger hints", () => {
    expect(tipTextProblems(inTroubleTip(30))).toEqual([]);
    expect(tipTextProblems(limitsTip("America/Argentina/ComodRivadavia"))).toEqual([]);
    for (const t of TRIGGERS) expect(tipTextProblems(t.hint), t.event).toEqual([]);
  });
});

describe("guardSummary", () => {
  const topicLabel = (k: string | null) => (k === "offers" ? "Offers" : (k ?? "this subject"));
  it("compresses the rules that can hold or skip a send into one sentence within the limit", () => {
    for (const tpl of TEMPLATES) {
      const def = tpl.build();
      def.steps.forEach((_, i) => {
        const g = guardSummary(def, i, DEFAULT_LIMITS, { topicLabel });
        if (g.count > 0) expect(tipTextProblems(g.text), `${tpl.id} step ${i + 1}`).toEqual([]);
      });
    }
  });
  it("counts the send rules and names the topic, the day off and the daily cap", () => {
    const def = TEMPLATES.find((t) => t.id === "quote_follow_up")!.build();
    const i = def.steps.findIndex((s) => s.kind === "send_newsletter");
    const g = guardSummary(def, i, DEFAULT_LIMITS, { topicLabel });
    expect(g.count).toBe(def.entry.pause_when_in_trouble ? 4 : 3);
    expect(g.text).toContain("no consent for Offers");
    expect(g.text).toContain("Friday");
    expect(g.text).toContain("an email today");
  });
  it("a wait or an end has no guards", () => {
    const def = TEMPLATES.find((t) => t.id === "quote_follow_up")!.build();
    expect(guardSummary(def, 0, DEFAULT_LIMITS).count).toBe(0);
  });
});
