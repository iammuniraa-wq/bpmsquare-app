import { describe, expect, it } from "vitest";
import { applyTenderFilter, parseTenderFilter, tenderFilterActive } from "./filters";
import { tenderLinks, TENDERS_TAB } from "@/lib/tenderDesk/links";
import { DEFAULT_TENDER_STAGES } from "@/lib/constants";

const STAGES = DEFAULT_TENDER_STAGES.map((s) => s.value);
const parse = (qs: string) => { const p = new URLSearchParams(qs); return parseTenderFilter((k) => p.get(k), STAGES); };

const NOW = new Date("2026-10-28T08:00:00Z");
const TZ = "Asia/Riyadh";
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, stage: "estimating", outcome: "open", account_id: "a1", closed_at: null,
  tender: { closing_at: "2026-11-20T09:00:00Z", issuer_account_id: null as string | null },
  ...over,
});
const ROWS = [
  row("soon", { tender: { closing_at: "2026-11-05T09:00:00Z", issuer_account_id: "c1000000-0000-0000-0000-000000000001" } }),                  // 8 days
  row("today", { stage: "received", tender: { closing_at: "2026-10-28T20:00:00Z", issuer_account_id: null } }),                                    // today
  row("past", { tender: { closing_at: "2026-10-20T09:00:00Z", issuer_account_id: null } }),                                                       // ended
  row("later", { tender: { closing_at: "2026-12-30T09:00:00Z", issuer_account_id: null } }),                                                      // far
  row("submittedSoon", { stage: "submitted", tender: { closing_at: "2026-11-02T09:00:00Z", issuer_account_id: null } }),                           // 5 days, submitted
  row("won-oct", { stage: "awarded", outcome: "won", closed_at: "2026-10-12T08:00:00Z", tender: { closing_at: null, issuer_account_id: null } }),
  row("won-sep", { stage: "awarded", outcome: "won", closed_at: "2026-09-12T08:00:00Z", tender: { closing_at: null, issuer_account_id: null } }),
  row("lost-oct", { stage: "bid_lost", outcome: "lost", closed_at: "2026-10-02T08:00:00Z", tender: { closing_at: null, issuer_account_id: null } }),
  row("noclose", { tender: { closing_at: null, issuer_account_id: null }, account_id: "a2" }),
];
const idsOf = (f: string) => applyTenderFilter(ROWS, parse(f), NOW, TZ).map((r) => r.id);

describe("the Tenders tab filters written by the dashboard", () => {
  it("reads nothing from an address without them, and drops anything malformed", () => {
    expect(parse("tab=tenders")).toEqual({});
    expect(tenderFilterActive(parse("tab=tenders"))).toBe(false);
    expect(parse("stage=nonsense&closing=abc&client=<script>&outcome=maybe&month=2026-10")).toEqual({});
    expect(parse("closing=0")).toEqual({});
    expect(parse("closing=-3")).toEqual({});
    expect(parse("closing=9999")).toEqual({});
    expect(parse("outcome=won&month=2026-13")).toEqual({ outcome: "won" });
    expect(parse("month=2026-10")).toEqual({});
  });

  it("reads each filter and lets them combine", () => {
    expect(parse("stage=estimating")).toEqual({ stage: "estimating" });
    expect(parse("closing=14")).toEqual({ closing: 14 });
    expect(parse("client=c1000000-0000-0000-0000-000000000001")).toEqual({ client: "c1000000-0000-0000-0000-000000000001" });
    expect(parse("outcome=lost&month=2026-10")).toEqual({ outcome: "lost", month: "2026-10" });
    expect(parse("stage=received&closing=14")).toEqual({ stage: "received", closing: 14 });
  });

  it("round-trips every link the dashboard writes", () => {
    expect(TENDERS_TAB).toBe("/pipeline?tab=tenders");
    const q = (href: string) => href.split("?")[1];
    expect(parse(q(tenderLinks.stage("bid_no_bid")))).toEqual({ stage: "bid_no_bid" });
    expect(parse(q(tenderLinks.closing(14)))).toEqual({ closing: 14 });
    expect(parse(q(tenderLinks.client("c1000000-0000-0000-0000-000000000001")))).toEqual({ client: "c1000000-0000-0000-0000-000000000001" });
    expect(parse(q(tenderLinks.outcome("won")))).toEqual({ outcome: "won" });
    expect(parse(q(tenderLinks.outcome("lost", "2026-10")))).toEqual({ outcome: "lost", month: "2026-10" });
    expect(parse(q(tenderLinks.tab))).toEqual({});
  });

  it("stage: only the tenders in that stage", () => {
    expect(idsOf("stage=received")).toEqual(["today"]);
    expect(idsOf("stage=submitted")).toEqual(["submittedSoon"]);
  });

  it("closing=14: the same tenders the dashboard tile counts, open, today or within 14 days, whatever their stage", () => {
    expect(idsOf("closing=14").sort()).toEqual(["soon", "submittedSoon", "today"].sort());
    expect(idsOf("closing=3")).toEqual(["today"]);
    expect(idsOf("closing=28").sort()).toEqual(["soon", "submittedSoon", "today"]);
  });

  it("client: by issuer account, else the deal's own account", () => {
    expect(idsOf("client=c1000000-0000-0000-0000-000000000001")).toEqual(["soon"]);
    expect(idsOf("client=a1-0000000000")).toEqual([]);
  });

  it("outcome: the won or the lost tenders; with a month, only those decided in it", () => {
    expect(idsOf("outcome=won").sort()).toEqual(["won-oct", "won-sep"]);
    expect(idsOf("outcome=lost")).toEqual(["lost-oct"]);
    expect(idsOf("outcome=won&month=2026-10")).toEqual(["won-oct"]);
    expect(idsOf("outcome=won&month=2026-09")).toEqual(["won-sep"]);
    expect(idsOf("outcome=lost&month=2026-09")).toEqual([]);
  });

  it("reads a decision's month in the workspace time zone, not UTC", () => {
    const edge = [row("edge", { stage: "awarded", outcome: "won", closed_at: "2026-09-30T22:30:00Z", tender: { closing_at: null, issuer_account_id: null } })];
    expect(applyTenderFilter(edge, { outcome: "won", month: "2026-10" }, NOW, TZ)).toHaveLength(1);
    expect(applyTenderFilter(edge, { outcome: "won", month: "2026-09" }, NOW, "UTC")).toHaveLength(1);
  });

  it("no filter changes nothing", () => {
    expect(applyTenderFilter(ROWS, {}, NOW, TZ)).toBe(ROWS);
  });

  it("filters combine: received tenders closing within 14 days", () => {
    expect(idsOf("stage=received&closing=14")).toEqual(["today"]);
  });
});
