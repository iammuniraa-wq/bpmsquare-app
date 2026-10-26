import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { tipTextProblems } from "@/lib/infoTip";
import { TENDER_TIPS } from "@/lib/tender/tips";

// GCC tender deals, slice 4: the shape of migration 0225, the bundle that carries it, the ledger, the gating map, the explanations
// behind the "i", the controls the assistant can point at, and the rule that a snapshot can never read a cost.

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0225_tender_bids.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const TABLES = ["tender_bid_versions", "deal_activities"];

describe("migration 0225", () => {
  it("is idempotent", () => {
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
    for (const m of code.matchAll(/create trigger (\w+)/gi)) expect(code, m[1]).toContain(`drop trigger if exists ${m[1]}`);
    for (const m of code.matchAll(/alter table (\w+) add column (if not exists )?(\w+)/gi)) expect(m[2], `${m[1]}.${m[3]}`).toBeTruthy();
    expect(code).toMatch(/create or replace function/);
  });

  it("every new table has tenant_id, RLS and a tenant SELECT policy and NOTHING that writes (a member must not forge or erase a bid)", () => {
    for (const t of TABLES) {
      expect(code, t).toMatch(new RegExp(`create table if not exists ${t} \\([^;]*?tenant_id uuid not null references tenants\\(id\\)`));
      expect(code, t).toMatch(new RegExp(`alter table ${t} enable row level security`));
      const policies = [...code.matchAll(new RegExp(`create policy "([^"]+)" on ${t} for (\\w+)`, "gi"))];
      expect(policies, t).toHaveLength(1);
      expect(policies[0][2].toLowerCase()).toBe("select");
      expect(code, t).toMatch(new RegExp(`on ${t} for select using \\(tenant_id in \\(select tenant_id from tenant_users where user_id = auth\\.uid\\(\\)\\)\\)`));
    }
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("a bid version is append-only (an UPDATE is refused), has no cap, and a reason from version 2", () => {
    expect(code).toMatch(/create trigger tender_bid_versions_immutable before update on tender_bid_versions/);
    expect(code).toMatch(/raise exception 'a submitted bid version cannot be changed'/);
    expect(code).toMatch(/unique \(opportunity_id, version_no\)/);
    expect(code).toMatch(/check \(version_no = 1 or revision_reason is not null\)/);
    expect(code).toMatch(/char_length\(revision_reason\) between 3 and 1000/);
    expect(code).not.toMatch(/version_no <=|version_no between/);
  });

  it("the snapshot has no cost or markup column", () => {
    const start = code.indexOf("create table if not exists tender_bid_versions");
    const block = code.slice(start, code.indexOf("create index", start));
    expect(block).not.toMatch(/cost|markup|margin/i);
  });

  it("has the columns the code reads", () => {
    for (const col of ["version_no", "submitted_at", "submitted_by", "currency", "total", "line_count", "lines", "note", "revision_reason"]) expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    for (const col of ["kind", "occurred_at", "with_whom", "summary", "outcome", "next_step", "next_step_due", "next_step_done_at", "logged_by"]) expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    expect(code).toMatch(/kind in \('call', 'meeting', 'site_visit', 'note'\)/);
    for (const col of ["award_value", "winning_bidder", "award_date", "outcome_note"]) expect(code, col).toMatch(new RegExp(`alter table opportunity_tenders add column if not exists ${col}\\b`));
  });

  it("adds no column to opportunities", () => {
    expect(code).not.toMatch(/alter table opportunities/i);
    const altered = [...code.matchAll(/alter table (\w+) add column/gi)].map((m) => m[1]);
    expect(new Set(altered)).toEqual(new Set(["opportunity_tenders"]));
  });

  it("the bundle carries the migration verbatim, and the ledger lists it as pending", () => {
    const bundle = lf(read("scripts/run-bundle-35-tender-bids-2026-10-26.sql"));
    expect(bundle).toContain(sql.trim());
    const project = read("PROJECT.md");
    expect(project).toMatch(/0225_tender_bids\.sql/);
    expect(project).toMatch(/run-bundle-35-tender-bids-2026-10-26\.sql/);
  });
});

describe("gating and wiring", () => {
  it("the new tables are owned by the tender module", () => {
    expect(featureForObject("tender_bid_versions")).toBe("gcc_tender");
    expect(featureForObject("deal_activities")).toBe("gcc_tender");
  });

  it("the explanations fit behind an i", () => {
    for (const key of ["bidsTab", "bidSubmit", "bidReason", "bidRevise", "bidCompare", "bidWorking", "callLog", "callNextStep", "callOverdue", "outcome", "outcomeLostTo", "outcomeCompare"] as const) {
      expect(tipTextProblems(TENDER_TIPS[key]), key).toEqual([]);
    }
  });

  it("every control of the new screens carries a data-guide id the assistant can point at", () => {
    const files = ["src/components/tender/BidsTab.tsx", "src/components/tender/CallsPanel.tsx", "src/components/tender/LogCall.tsx", "src/components/tender/OutcomeSection.tsx", "src/app/(app)/pipeline/[id]/TenderOverview.tsx"];
    const ids = new Set(files.flatMap((f) => [...read(f).matchAll(/"(tender\.[a-z_.]+)"/g)].map((m) => m[1])));
    for (const id of [
      "tender.bids", "tender.bid.submit", "tender.bid.revise", "tender.bid.reason", "tender.bid.confirm", "tender.bid.compare", "tender.bid.compare_from", "tender.bid.compare_to",
      "tender.calls", "tender.call.log", "tender.call.save", "tender.call.summary", "tender.call.next_step", "tender.call.done", "tender.call.remove", "tender.overdue_steps",
      "tender.outcome", "tender.outcome.save", "tender.outcome.won_by", "tender.outcome.loss_reason", "tender.outcome.value", "tender.outcome.compare",
    ]) expect(ids, id).toContain(id);
  });

  it("the capability text for the edition mentions the bids, the calls and the outcome", () => {
    const doc = read("docs/capabilities/gcc_tender.md");
    expect(doc).toMatch(/Bids tab/);
    expect(doc).toMatch(/Log a call/);
    expect(doc).toMatch(/outcome/i);
  });
});

describe("the routes", () => {
  const routes = [
    "src/app/api/opportunities/[id]/tender/bids/route.ts", "src/app/api/opportunities/[id]/tender/bids/compare/route.ts",
    "src/app/api/opportunities/[id]/tender/calls/route.ts", "src/app/api/opportunities/[id]/tender/calls/[callId]/route.ts", "src/app/api/opportunities/[id]/tender/outcome/route.ts",
  ];

  it("all open through the one gate and never read the workspace or the author from the request", () => {
    for (const f of routes) {
      const src = read(f);
      expect(src, f).toMatch(/openTenderDealRequest\(/);
      expect(src, f).not.toMatch(/body\.tenant_id|searchParams\.get\("tenant|body\.logged_by|body\.submitted_by/);
    }
    const gate = read("src/lib/tender/dealAccess.ts");
    expect(gate).toMatch(/requireTenantUser\(\)/);
    // The flags are read before any table is touched.
    expect(gate.indexOf("tenantHasFeature")).toBeLessThan(gate.indexOf("loadOpportunity(admin"));
  });

  it("a bid version is only ever inserted and read: no update, no delete, and no cost column is read", () => {
    const route = read("src/app/api/opportunities/[id]/tender/bids/route.ts");
    const server = read("src/lib/tender/bids/server.ts");
    for (const src of [route, server, read("src/app/api/opportunities/[id]/tender/bids/compare/route.ts")]) {
      expect(src).not.toMatch(/tender_bid_versions"\)\s*\.(update|delete|upsert)/);
      expect(src).not.toMatch(/unit_cost|markup_pct|cost_price/);
    }
  });

  it("submitting moves the stage through the deal's own PATCH, after asking the same stage rule", () => {
    const route = read("src/app/api/opportunities/[id]/tender/bids/route.ts");
    expect(route).toMatch(/import\("@\/app\/api\/opportunities\/\[id\]\/route"\)/);
    expect(route).toMatch(/stageGuard\(/);
    expect(route).not.toMatch(/from\("opportunities"\)\s*\.update/);
  });

  it("the standard deal files know nothing of the new tables", () => {
    for (const f of ["src/app/api/opportunities/route.ts", "src/app/(app)/pipeline/new/NewOpportunityForm.tsx", "src/lib/sales/opportunity.ts"]) {
      expect(read(f), f).not.toMatch(/tender_bid_versions|deal_activities/);
    }
  });

  it("the lines are read for the snapshot in the client's file order", () => {
    expect(read("src/lib/tender/bids/server.ts")).toMatch(/boqOrderedLines\(/);
  });
});
