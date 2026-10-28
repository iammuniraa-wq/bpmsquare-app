import { describe, expect, it } from "vitest";
import { tenderLinks, TENDERS_TAB } from "./links";
import { TENDER_BLOCK_TIPS, DASH_LOOK_TIP } from "./tips";
import { tipTextProblems } from "@/lib/infoTip";
import { ROUTES } from "@/lib/constants";

describe("where the tender blocks go", () => {
  it("every address starts at the Tenders tab of the Pipeline", () => {
    expect(TENDERS_TAB).toBe(`${ROUTES.pipeline}?tab=tenders`);
    expect(tenderLinks.tab).toBe("/pipeline?tab=tenders");
    expect(tenderLinks.stage("estimating")).toBe("/pipeline?tab=tenders&stage=estimating");
    expect(tenderLinks.closing()).toBe("/pipeline?tab=tenders&closing=14");
    expect(tenderLinks.closing(28)).toBe("/pipeline?tab=tenders&closing=28");
    expect(tenderLinks.client("c1")).toBe("/pipeline?tab=tenders&client=c1");
    expect(tenderLinks.outcome("won")).toBe("/pipeline?tab=tenders&outcome=won");
    expect(tenderLinks.outcome("lost", "2026-10")).toBe("/pipeline?tab=tenders&outcome=lost&month=2026-10");
  });

  it("writes nothing unsafe into an address", () => {
    expect(tenderLinks.stage("a&b=c")).toBe("/pipeline?tab=tenders&stage=a%26b%3Dc");
    expect(tenderLinks.client("x y")).toBe("/pipeline?tab=tenders&client=x%20y");
  });

  it("buy-out goes to the Buy-out tab of the project the desk drew, or to the contract projects when there is none", () => {
    expect(tenderLinks.buyout({ projectId: "p1", projectName: "P", href: "/contract-projects/p1", packages: [] })).toBe("/contract-projects/p1?tab=buyout");
    expect(tenderLinks.buyout({ projectId: "p1", projectName: "P", href: "/contract-projects/p1?x=1", packages: [] })).toBe("/contract-projects/p1?x=1&tab=buyout");
    expect(tenderLinks.buyout(null)).toBe(ROUTES.contractProjects);
    expect(tenderLinks.buyout(undefined)).toBe("/contract-projects");
  });
});

describe("the explanations behind the i", () => {
  it("fit the shared limit: two sentences, 160 characters", () => {
    for (const [k, text] of Object.entries({ ...TENDER_BLOCK_TIPS, look: DASH_LOOK_TIP })) expect(tipTextProblems(text), k).toEqual([]);
  });
});
