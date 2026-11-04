import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, ROUTES } from "@/lib/constants";
import { WORKCENTERS, WORKCENTER_PARTS } from "@/lib/workcenters";
import { buildNavGroups, navFeatureOn } from "@/lib/navGroups";
import { tipTextProblems } from "@/lib/infoTip";

const src = (...p: string[]) => readFileSync(join(__dirname, "..", "..", "app", "(app)", "marketing", ...p), "utf8");
const allFeatures = Object.fromEntries(NAV.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])])).flatMap((i) => [...(i.featureKey ? [i.featureKey] : []), ...(i.featureAnyOf ?? [])]).map((k) => [k, true]));
const labels = (features: Record<string, boolean>, viewable: Parameters<typeof buildNavGroups>[1] = "all") =>
  buildNavGroups(features, viewable, false).map((g) => `${g.label}:${g.items.map((i) => i.label).join(",")}`);

describe("the two Overview screens", () => {
  it("each part opens with an Overview row", () => {
    const first = (group: string) => NAV.find((g) => g.group === group)!.items[0];
    expect(first("MARKETING").children![0]).toMatchObject({ label: "Overview", href: ROUTES.marketing });
    expect(first("INTELLIGENCE").children![0]).toMatchObject({ label: "Overview", href: ROUTES.marketingIntelligence });
    expect(first("MARKETING").href).toBe(ROUTES.marketing);
    expect(first("INTELLIGENCE").href).toBe(ROUTES.marketingIntelligence);
  });

  it("the Intelligence Overview needs one of its modules, so a workspace without them sees no Intelligence group", () => {
    expect(labels({ marketing: true }).some((l) => l.startsWith("Intelligence"))).toBe(false);
    expect(labels({ marketing: true, abm: true })).toContain("Intelligence:Overview,ABM programs");
    expect(navFeatureOn({ label: "x", href: "/x", icon: "", pillar: "purple", featureAnyOf: ["abm", "leads"] }, { leads: true })).toBe(true);
    expect(navFeatureOn({ label: "x", href: "/x", icon: "", pillar: "purple", featureAnyOf: ["abm", "leads"] }, {})).toBe(false);
  });

  it("a role that can open none of the Intelligence modules does not see the group", () => {
    expect(labels(allFeatures, ["marketing", "marketing_segments"]).some((l) => l.startsWith("Intelligence"))).toBe(false);
    expect(labels(allFeatures, ["signals"])).toContain("Intelligence:Overview,Buying signals");
    expect(labels(allFeatures, ["signals"]).some((l) => l.startsWith("Marketing"))).toBe(false);
  });

  it("the role editor groups every marketing key under exactly one part, and each key exists", () => {
    const keys = WORKCENTER_PARTS.flatMap((p) => p.keys);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(WORKCENTERS.some((w) => w.key === k), k).toBe(true);
  });

  it("the page explanations fit the InfoTip limit", () => {
    for (const file of [["page.tsx"], ["intelligence", "page.tsx"]]) {
      const m = src(...file).match(/info="([^"]+)"/);
      expect(m, file.join("/")).not.toBeNull();
      expect(tipTextProblems(m![1]), file.join("/")).toEqual([]);
    }
  });
});
