import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CallsData, CallView } from "@/lib/tender/calls";
import type { BidsData } from "@/lib/tender/bids/rules";
import type { OutcomeData } from "@/lib/tender/outcome";
import { boqStepFacts } from "./BoqTab";
import { tenderSteps } from "@/lib/tender/steps";
import { bidsUrl, callsUrl, mergeBids, mergeCalls, mergeOutcome, reloadAfterSave, type Fetcher } from "./refreshAfterSave";

// After a save, the calls list, the Outcome section and the Bids tab show what was saved without a page reload: each reloads what it
// shows from its endpoint and then calls its parent's onChanged (which refreshes the page's header facts), like BoqTab.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const OPP = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const json = (body: unknown, ok = true): Fetcher => async () => ({ ok, json: async () => body });

const call = (id: string): CallView => ({ id, kind: "call", occurred_at: "2026-10-20T09:00:00Z", with_whom: null, summary: `call ${id}`, outcome: null, next_step: null, next_step_due: null, next_step_done_at: null, logged_by_name: "S. Khan", can_change: true });
const calls = (list: CallView[]): CallsData => ({ calls: list, pending: false, canEdit: true });

describe("the step tracker after a BOQ upload", () => {
  it("the BOQ tab hands the page the facts it just re-read, so the Next row moves without waiting for the server render", () => {
    const totals = { lines: 12, priced: 3, unpriced: 9, stale: 1, amount: 4500, no_product: 2 };
    expect(boqStepFacts({ source: { file_name: "boq.xlsx", sheet_name: "BOQ", version: 1, uploaded_at: "2026-11-19T09:00:00Z", line_count: 12, added_columns: false }, totals }))
      .toEqual({ hasBoq: true, lines: 12, unpriced: 9, stale: 1, noProduct: 2, amount: 4500 });
    expect(boqStepFacts({ source: null, totals })).toEqual({ hasBoq: false, lines: 0, unpriced: 0, stale: 0, noProduct: 0, amount: 0 });
    // With those facts the path leaves "upload the client's BOQ".
    const base = { stage: "estimating", outcome: "open", bids: 0, canEdit: true, approvedGo: true, proposalPending: false, canDecide: false, project: null, decisionStanding: "go" as const, closingAt: null, projectId: null };
    const f = boqStepFacts({ source: { file_name: "boq.xlsx", sheet_name: "BOQ", version: 1, uploaded_at: "2026-11-19T09:00:00Z", line_count: 12, added_columns: false }, totals });
    const before = tenderSteps({ ...base, hasBoq: false, boqLines: 0, unpriced: 0, stale: 0 } as Parameters<typeof tenderSteps>[0]);
    const after = tenderSteps({ ...base, hasBoq: f.hasBoq, boqLines: f.lines, unpriced: f.unpriced, stale: f.stale, noProduct: f.noProduct, boqAmount: f.amount } as Parameters<typeof tenderSteps>[0]);
    expect(before.next.title).toBe("Next: upload the client's BOQ");
    expect(after.next.title).toBe("Next: price every BOQ line");
  });

  it("is wired: the tab reports after its reload, the page keeps the facts in state and the server render replaces them", () => {
    const tab = read("src/components/tender/BoqTab.tsx");
    expect(tab).toContain("reloadAfterSave<State>(base, (fresh) => { setData(fresh); onFacts?.(boqStepFacts(fresh)); }, onLinesChanged)");
    const page = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
    expect(page).toContain("onFacts={setBoqFacts}");
    expect(page).toContain("useEffect(() => { setBoqFacts(tender?.boq ?? null); }, [tender?.boq]);");
    expect(page).toContain("onLinesChanged={() => router.refresh()}");
  });
});

describe("reloadAfterSave", () => {
  it("applies what the endpoint answers, then calls onChanged", async () => {
    const order: string[] = [];
    const reloaded = await reloadAfterSave<{ calls: CallView[] }>(callsUrl(OPP), (f) => order.push(`apply:${f.calls.length}`), () => order.push("changed"), json({ calls: [call("a")] }));
    expect(reloaded).toBe(true);
    expect(order).toEqual(["apply:1", "changed"]);
  });

  it("reads the right endpoints, uncached", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const spy: Fetcher = async (url, init) => { seen.push({ url, init }); return { ok: true, json: async () => ({}) }; };
    await reloadAfterSave(callsUrl(OPP), () => {}, undefined, spy);
    await reloadAfterSave(bidsUrl(OPP), () => {}, undefined, spy);
    expect(seen.map((s) => s.url)).toEqual([`/api/opportunities/${OPP}/tender/calls`, `/api/opportunities/${OPP}/tender/bids`]);
    expect(seen.every((s) => s.init?.cache === "no-store")).toBe(true);
  });

  it("still tells the parent when the reload fails, and applies nothing", async () => {
    let applied = 0; let changed = 0;
    const bad = await reloadAfterSave(callsUrl(OPP), () => { applied++; }, () => { changed++; }, json({ error: "no" }, false));
    const thrown = await reloadAfterSave(callsUrl(OPP), () => { applied++; }, () => { changed++; }, async () => { throw new Error("offline"); });
    expect([bad, thrown, applied, changed]).toEqual([false, false, 0, 2]);
  });
});

describe("what the reload puts on the screen", () => {
  it("a logged call appears in the list (and edit rights stay the page's)", () => {
    const shown = mergeCalls(calls([]), { calls: [call("new")], pending: false });
    expect(shown.calls.map((k) => k.id)).toEqual(["new"]);
    expect(shown.canEdit).toBe(true);
    expect(mergeCalls(calls([call("a")]), { calls: [] }).calls).toEqual([]);
  });

  it("a removed or ticked-off call is reflected from the same reload", () => {
    const after = mergeCalls(calls([call("a"), call("b")]), { calls: [call("b")] });
    expect(after.calls.map((k) => k.id)).toEqual(["b"]);
  });

  it("a submitted bid version appears in the versions and the working total is untouched", () => {
    const v = (n: number, total: number) => ({ id: `v${n}`, version_no: n, submitted_at: "2026-10-12T09:00:00Z", submitted_by_name: null, currency: "SAR", total, line_count: 3, revision_reason: null, note: null });
    const cur: BidsData = { versions: [v(1, 100)], pending: false, working_total: 120, canEdit: true };
    const next = mergeBids(cur, { versions: [v(2, 120), v(1, 100)] });
    expect(next.versions.map((x) => x.version_no)).toEqual([2, 1]);
    expect(next.working_total).toBe(120);
  });

  it("a saved award value shows at once, with the difference input the screen computes from it", () => {
    const cur: OutcomeData = { stage: "awarded", award_value: null, winning_bidder: null, award_date: null, outcome_note: null, competitor: null, loss_reason: null, our_total: 6500, our_version: 2, currency: "SAR", canEdit: true, pending: false };
    const next = mergeOutcome(cur, { award_value: 6400, winning_bidder: null, award_date: "2026-10-25", outcome_note: "Signed" }, { lost: false, winning_bidder: "", loss_reason: "" });
    expect(next.award_value).toBe(6400);
    expect(next.award_date).toBe("2026-10-25");
    expect(next.our_total).toBe(6500);
  });

  it("a lost tender keeps the winner and the reason that were just saved", () => {
    const cur: OutcomeData = { stage: "bid_lost", award_value: null, winning_bidder: null, award_date: null, outcome_note: null, competitor: null, loss_reason: null, our_total: 6500, our_version: 2, currency: "SAR", canEdit: true, pending: false };
    const next = mergeOutcome(cur, { award_value: 6000, winning_bidder: "Acme", award_date: null, outcome_note: null }, { lost: true, winning_bidder: " Acme ", loss_reason: "price" });
    expect([next.award_value, next.winning_bidder, next.competitor, next.loss_reason]).toEqual([6000, "Acme", "Acme", "price"]);
  });
});

describe("the wiring", () => {
  const logCall = read("src/components/tender/LogCall.tsx");
  const panel = read("src/components/tender/CallsPanel.tsx");
  const outcome = read("src/components/tender/OutcomeSection.tsx");
  const bidsTab = read("src/components/tender/BidsTab.tsx");
  const detail = read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx");
  const tenderTab = read("src/app/(app)/pipeline/[id]/TenderOverview.tsx");

  it("Log a call calls onLogged after a successful save (the page refreshes itself only when nobody listens)", () => {
    expect(logCall).toMatch(/if \(onLogged\) onLogged\(\); else router\.refresh\(\);/);
    expect(logCall.indexOf("if (!res.ok)")).toBeLessThan(logCall.indexOf("onLogged()"));
  });

  it("the calls list reloads after Log a call, Mark done, Reopen and Remove, then tells the page", () => {
    expect(panel).toContain("onLogged={() => { void reload(); }}");
    expect(panel).toMatch(/setAsking\(null\);\s*await reload\(\);/);
    expect(panel).toContain("callsUrl(opportunityId)");
    expect(panel).toContain("onChanged");
    expect(panel).not.toContain("router.refresh");
    expect(panel).toMatch(/useEffect\(\(\) => \{ setData\(serverData\); \}, \[serverData\]\)/);
  });

  it("the Outcome section shows the saved facts at once and tells the page", () => {
    expect(outcome).toMatch(/setData\(\(cur\) => mergeOutcome\(cur, j,/);
    expect(outcome.indexOf("mergeOutcome(cur, j")).toBeLessThan(outcome.indexOf("onChanged?.()"));
    expect(outcome).not.toContain("router.refresh");
  });

  it("the Bids tab reloads the versions after Submit (a revision included) and tells the page", () => {
    expect(bidsTab).toContain("bidsUrl(opportunityId)");
    expect(bidsTab).toMatch(/await reloadAfterSave<[\s\S]*?\}, onChanged\);/);
    // A revision that reopened the tender and then failed still tells the page, so the stage shown is the one it is in.
    expect(bidsTab).toMatch(/if \(reopened\.current\) onChanged\?\.\(\); return;/);
    expect(bidsTab).not.toContain("router.refresh");
  });

  it("the pages hand each one the callback that refreshes the header facts", () => {
    expect(detail).toContain("<CallsPanel opportunityId={opp.id} data={tender.calls} todayKey={todayKey} onChanged={() => router.refresh()} />");
    expect(detail).toContain("<LogCallButton opportunityId={opp.id} onLogged={() => router.refresh()} />");
    expect(detail).toMatch(/<BidsTab [^\n]*onChanged=\{\(\) => router\.refresh\(\)\}/);
    expect(tenderTab).toMatch(/<OutcomeSection [^\n]*onChanged=\{\(\) => router\.refresh\(\)\}/);
  });
});
