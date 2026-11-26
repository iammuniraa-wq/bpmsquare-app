import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ApprovalView } from "@/lib/tender/approval";
import { approvalUrl, reloadAfterSave, type Fetcher } from "./refreshAfterSave";

// After "Propose bid decision" / "Approve" the drawer closes and the header button, the bid-decision marker and the step panel must show the
// new state at once, not after a reload. The page re-reads the decision from its endpoint, applies it, and refreshes the server render.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const waiting = { standing: null, recordedBefore: false, pending: { id: "a1", decision: "go", status: "pending", reason: "Good fit", comment: null, requested_by_name: "S. Khan", decided_by_name: null, requested_at: "2026-10-26T09:00:00Z", decided_at: null, mine: true }, canDecide: false, proposalBlocked: null, history: [] } as unknown as ApprovalView;

describe("the bid decision re-read after a save", () => {
  it("reads the approval endpoint uncached, applies it, then refreshes the page", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetcher: Fetcher = async (url, init) => { seen.push({ url, init }); return { ok: true, json: async () => waiting }; };
    const order: string[] = [];
    const reloaded = await reloadAfterSave<ApprovalView>(approvalUrl(OPP), (a) => order.push(`apply:${a.pending?.status}`), () => order.push("refresh"), fetcher);
    expect(reloaded).toBe(true);
    expect(order).toEqual(["apply:pending", "refresh"]);
    expect(seen[0].url).toBe(`/api/opportunities/${OPP}/tender/approval`);
    expect(seen[0].init).toMatchObject({ cache: "no-store" });
  });

  it("still refreshes the page when the re-read fails, so the server render brings the same facts", async () => {
    const order: string[] = [];
    const down: Fetcher = async () => { throw new Error("offline"); };
    expect(await reloadAfterSave<ApprovalView>(approvalUrl(OPP), () => order.push("apply"), () => order.push("refresh"), down)).toBe(false);
    const notOk: Fetcher = async () => ({ ok: false, json: async () => ({}) });
    expect(await reloadAfterSave<ApprovalView>(approvalUrl(OPP), () => order.push("apply"), () => order.push("refresh"), notOk)).toBe(false);
    expect(order).toEqual(["refresh", "refresh"]);
  });

  it("is wired: every save in the drawer reports to the page, which feeds the header, marker and step panel from the fresh decision", () => {
    const page = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(page).toContain("reloadAfterSave<ApprovalView>(approvalUrl(opp.id), setApprovalNow, () => router.refresh())");
    expect(page).toContain("onSaved={() => void reloadApproval()}");
    expect((page.match(/approvalNow \? approvalNow\.standing\?\.decision === "go" : null/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(page).toContain("proposalPending: !!approvalNow?.pending");
    const panel = read("src/app/(app)/pipeline/[id]/BidDecision.tsx");
    expect(panel).toContain("if (onSaved) onSaved(); else router.refresh();");
  });
});
