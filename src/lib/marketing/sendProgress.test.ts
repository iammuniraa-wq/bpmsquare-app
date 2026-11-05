import { describe, expect, it } from "vitest";
import { tipTextProblems } from "@/lib/infoTip";
import { QUOTA_LINE, REST_TIP, countStatuses, isQuotaError, pollDelay, progressText, recipientKey, restCandidates } from "./sendProgress";

const c = (account_id: string | null, manual_email: string | null = null) => ({ account_id, manual_email });

describe("the provider's daily limit", () => {
  it("is recognised from the provider's own words", () => {
    expect(isQuotaError("You have reached your daily email sending quota")).toBe(true);
    expect(isQuotaError("Daily quota exceeded")).toBe(true);
    expect(isQuotaError("The recipient address is invalid")).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
  it("is said in one plain line", () => {
    expect(tipTextProblems(QUOTA_LINE)).toEqual([]);
    expect(tipTextProblems(REST_TIP)).toEqual([]);
  });
});

describe("Send the rest", () => {
  const rows = [
    { ...c("a1"), status: "sent" }, { ...c("a2"), status: "failed" }, { ...c("a3"), status: "skipped_no_consent" },
    { ...c(null, "x@y.com"), status: "failed" }, { ...c(null, "s@y.com"), status: "sent" },
  ];
  const all = [c("a1"), c("a2"), c("a3"), c("a4"), c(null, "x@y.com"), c(null, "S@y.com")];

  it("never includes anyone already sent or deliberately left out; keeps failed and never-tried", () => {
    expect(restCandidates(all, rows).map(recipientKey)).toEqual(["a:a2", "a:a4", "m:x@y.com"]);
  });

  it("is idempotent: once everyone failed is sent, the rest is empty", () => {
    const after = rows.map((r) => (r.status === "failed" ? { ...r, status: "sent" } : r));
    expect(restCandidates(all, after).map(recipientKey)).toEqual(["a:a4"]);
  });

  it("counts statuses the way the tiles do", () => {
    expect(countStatuses(rows)).toEqual({ sent: 2, failed: 2, skipped: 1 });
  });
});

describe("progress and polling", () => {
  it("shows a count", () => {
    expect(progressText(4, 8)).toBe("Sending… 4 of 8");
    expect(progressText(4, null)).toBe("Sending… 4 so far");
  });
  it("starts at 3 seconds, slows down and caps at 10", () => {
    expect(pollDelay(0)).toBe(3000);
    expect(pollDelay(25)).toBe(5500);
    expect(pollDelay(500)).toBe(10000);
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
const route = (...p: string[]) => readFileSync(join(__dirname, "..", "..", "app", ...p), "utf8");

describe("the send route's rest-of-the-campaign mode", () => {
  const send = route("api", "marketing", "campaigns", "[id]", "send", "route.ts");

  it("is claimed atomically from a campaign that already went out, so two presses cannot both send", () => {
    expect(send).toContain('searchParams.get("retry") === "rest"');
    expect(send).toContain('.in("status", ["sent", "failed"]).select("id")');
  });

  it("goes through the same consent gate, only for people not yet sent, and updates a failed row instead of adding one", () => {
    expect(send).toContain("restCandidates(everyone, recorded)");
    expect(send).toContain("plainCampaignConsent(");
    expect(send).toContain("failedRowOf");
  });

  it("does not announce the campaign as sent a second time", () => {
    expect(send).toContain("if (!retry) await emitCampaignSent");
  });

  it("the progress route and the page are tenant-scoped and gated like the rest of campaigns", () => {
    const progress = route("api", "marketing", "campaigns", "[id]", "progress", "route.ts");
    expect(progress).toContain('requireMarketingAccess(["marketing"], "view")');
    expect(progress.match(/\.eq\("tenant_id", tenantId\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(route("(app)", "marketing", "[id]", "page.tsx")).toContain("CampaignSendStatus");
  });
});
