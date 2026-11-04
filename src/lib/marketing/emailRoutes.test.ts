import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES } from "@/lib/constants";

const page = (...p: string[]) => readFileSync(join(__dirname, "..", "..", "app", "(app)", "marketing", ...p), "utf8");

// Old addresses keep working (docs/design/marketing-two-parts.md section 8): the campaign list and the newsletter list
// are views of Email now, and a bookmark or a stored link lands there.
describe("Email absorbs the campaign and newsletter lists", () => {
  it("/marketing is the Marketing Overview now; the campaign list is Email", () => {
    const src = page("page.tsx");
    expect(src).not.toContain("redirect(");
    expect(src).toContain("OverviewPath");
    expect(src).toContain("ROUTES.marketingEmail");
  });

  it("the old newsletter list redirects to the Newsletters or Templates view of Email", () => {
    const src = page("newsletters", "page.tsx");
    expect(src).toContain("redirect(");
    expect(src).toContain('"templates" : "designs"');
    expect(src).toContain("ROUTES.marketingEmail");
  });

  it("record addresses did not move", () => {
    expect(ROUTES.marketingCampaign("x")).toBe("/marketing/x");
    expect(ROUTES.marketingNewsletter("x")).toBe("/marketing/newsletters/x");
    expect(ROUTES.marketingNew).toBe("/marketing/new");
    expect(ROUTES.marketingEmail).toBe("/marketing/email");
  });

  it("the studio views are shown only with the studio flag", () => {
    const src = page("email", "page.tsx");
    expect(src).toContain("features?.newsletter_studio");
    expect(src).toContain("DesignsList");
    expect(page("newsletters", "DesignsList.tsx")).toContain("studioPage()");
  });
});
