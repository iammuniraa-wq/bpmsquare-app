import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const nav = vi.hoisted(() => ({ qs: "tab=tenders" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(nav.qs),
  usePathname: () => "/pipeline",
}));
vi.mock("next/link", () => ({ default: (p: { href: string; style?: unknown; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import TendersPanel, { filterChips } from "./TendersPanel";
import { DEFAULT_TENDER_STAGES } from "@/lib/constants";
import type { TenderBoardRow } from "@/lib/tender/views";
import { tenderLinks } from "@/lib/tenderDesk/links";

// The Tenders tab opened from the dashboard: each link the tender blocks write narrows the board to what the block counted.

const NOW = "2026-10-28T08:00:00.000Z";
const C1 = "c1000000-0000-0000-0000-000000000001";
const row = (id: string, title: string, over: Record<string, unknown> = {}, tender: Record<string, unknown> = {}) => ({
  id, tenant_id: "t1", ref: `OPP-${id}`, account_id: "a1", contact_id: null, lead_id: null, source: "direct", source_campaign_id: null, title, description: null,
  stage: "estimating", outcome: "open", loss_reason: null, loss_note: null, expected_close: null, amount: 1_000_000, currency: null, probability: 20, probability_override: null,
  probability_override_reason: null, owner_id: "u1", team: [], competitor: null, approval_status: null, custom_data: null, created_by: "u1",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", closed_at: null, account_name: "Acme", stage_since: "2026-10-01T00:00:00Z", ...over,
  tender: { tender_no: `T-${id}`, issuer_name: "Aramco", issuer_account_id: null, portal: "email", closing_at: "2026-12-30T09:00:00.000Z", decision: null, ...tender },
});
const ROWS = [
  row("1", "Estimating one", { stage: "estimating" }, { closing_at: "2026-11-05T09:00:00.000Z", issuer_account_id: C1 }),
  row("2", "Received soon", { stage: "received" }, { closing_at: "2026-10-30T09:00:00.000Z" }),
  row("3", "Far one", { stage: "estimating" }, { closing_at: "2027-01-30T09:00:00.000Z" }),
  row("4", "Submitted soon", { stage: "submitted" }, { closing_at: "2026-11-02T09:00:00.000Z" }),
  row("5", "Won in October", { stage: "awarded", outcome: "won", closed_at: "2026-10-12T08:00:00Z" }, { closing_at: null }),
  row("6", "Lost in October", { stage: "bid_lost", outcome: "lost", closed_at: "2026-10-03T08:00:00Z" }, { closing_at: null }),
  row("7", "Won in September", { stage: "awarded", outcome: "won", closed_at: "2026-09-12T08:00:00Z" }, { closing_at: null }),
] as unknown as TenderBoardRow[];

const html = (qs: string) => {
  nav.qs = qs;
  return renderToString(createElement(TendersPanel, {
    rows: ROWS, stages: DEFAULT_TENDER_STAGES, pending: false, members: [{ user_id: "u1", name: "Abdul", email: null }],
    accounts: [{ id: C1, name: "National Water Company" }, { id: "a1", name: "Acme" }], todayKey: "2026-10-28", currentUserId: "u1", nowIso: NOW, timezone: "Asia/Riyadh",
  })).replace(/<!-- -->/g, "");
};
/** The board, without the "Bids ending soon" section above it. */
const board = (out: string) => out.slice(out.indexOf('data-guide="tender.filter"') > 0 ? out.indexOf('data-guide="tender.filter"') : out.indexOf("Open <b"));
const titles = (out: string) => ["Estimating one", "Received soon", "Far one", "Submitted soon", "Won in October", "Lost in October", "Won in September"].filter((t) => board(out).includes(t));

describe("the Tenders tab opened from the dashboard", () => {
  it("shows the whole board and no filter chips when nothing narrows it", () => {
    const out = html("tab=tenders");
    expect(out).not.toContain('data-guide="tender.filter"');
    expect(out).not.toContain("Show all tenders");
    expect(titles(out)).toEqual(["Estimating one", "Received soon", "Far one", "Submitted soon"]);
  });

  it("?stage= shows one stage's tenders and says so, with a way back to all", () => {
    const out = html("tab=tenders&stage=estimating");
    expect(titles(out)).toEqual(["Estimating one", "Far one"]);
    expect(out).toContain('data-guide="tender.filter"');
    expect(out).toContain(">Estimating<");
    expect(out).toContain("2 tenders");
    expect(out).toContain('href="/pipeline?tab=tenders"');
    expect(out).toContain("Show all tenders");
    expect(out).not.toContain("Bid/No-bid</span>");
  });

  it("?closing=14 shows the open tenders whose bid ends within 14 days, whatever their stage", () => {
    const out = html("tab=tenders&closing=14");
    expect(titles(out)).toEqual(["Estimating one", "Received soon", "Submitted soon"]);
    expect(out).toContain("Closing in 14 days");
    expect(out).toContain("3 tenders");
  });

  it("?client= shows one client's tenders, named in the chip", () => {
    const out = html(`tab=tenders&client=${C1}`);
    expect(titles(out)).toEqual(["Estimating one"]);
    expect(out).toContain("National Water Company");
    expect(out).toContain("1 tender<");
  });

  it("?outcome=won shows the won tenders in the closed column, ?outcome=lost the lost ones, and a month narrows them", () => {
    const won = html("tab=tenders&outcome=won");
    expect(titles(won)).toEqual(["Won in October", "Won in September"]);
    expect(won).toContain(">Won<");
    expect(won).toContain(">Awarded<");
    expect(titles(html("tab=tenders&outcome=lost"))).toEqual(["Lost in October"]);
    expect(titles(html("tab=tenders&outcome=won&month=2026-10"))).toEqual(["Won in October"]);
    expect(html("tab=tenders&outcome=won&month=2026-10")).toContain("2026-10");
  });

  it("ignores a value it does not know and shows the whole board", () => {
    expect(titles(html("tab=tenders&stage=nonsense&outcome=maybe&closing=x"))).toEqual(["Estimating one", "Received soon", "Far one", "Submitted soon"]);
  });

  it("the chips' words", () => {
    expect(filterChips({ stage: "estimating", closing: 14 }, DEFAULT_TENDER_STAGES, [])).toEqual(["Estimating", "Closing in 14 days"]);
    expect(filterChips({ client: "zzz" }, DEFAULT_TENDER_STAGES, [])).toEqual(["One client"]);
    expect(filterChips({}, DEFAULT_TENDER_STAGES, [])).toEqual([]);
  });

  it("every link the dashboard writes lands on a tab that filters", () => {
    const stage = tenderLinks.stage("received").split("?")[1];
    expect(titles(html(stage))).toEqual(["Received soon"]);
    expect(titles(html(tenderLinks.closing(14).split("?")[1]))).toHaveLength(3);
    expect(titles(html(tenderLinks.outcome("won").split("?")[1]))).toHaveLength(2);
    expect(titles(html(tenderLinks.client(C1).split("?")[1]))).toEqual(["Estimating one"]);
  });
});
