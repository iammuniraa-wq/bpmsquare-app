import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";

// GCC tender deals, slice 3c-1: the shape of migration 0227, the bundle that carries it, the ledger, the gating map, the capability text,
// the doors every route opens through, and the rule that a cost never travels into a file or link a customer can reach.

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0227_estimates_in_tender.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}

describe("migration 0227", () => {
  it("is idempotent and stops with a plain message when what it needs is missing", () => {
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
    for (const m of code.matchAll(/alter table (\w+) add column (if not exists )?(\w+)/gi)) expect(m[2], `${m[1]}.${m[3]}`).toBeTruthy();
    for (const t of ["estimates", "estimate_lines", "tender_boq_lines", "rfqs", "rfq_lines"]) expect(code, t).toContain(`to_regclass('public.${t}')`);
    expect(code).toMatch(/raise exception 'Run 0131/);
    expect(code).toMatch(/raise exception 'Run 0223/);
    expect(code).toMatch(/raise exception 'Run 0128/);
  });

  it("the new table has tenant_id, RLS and a tenant SELECT policy and NOTHING that writes (a member must not re-price a bid through PostgREST)", () => {
    expect(code).toMatch(/create table if not exists tender_boq_estimate_links \([^;]*?tenant_id uuid not null references tenants\(id\)/);
    expect(code).toMatch(/alter table tender_boq_estimate_links enable row level security/);
    const policies = [...code.matchAll(/create policy "([^"]+)" on tender_boq_estimate_links for (\w+)/gi)];
    expect(policies).toHaveLength(1);
    expect(policies[0][2].toLowerCase()).toBe("select");
    expect(code).toMatch(/on tender_boq_estimate_links for select using \(tenant_id in \(select tenant_id from tenant_users where user_id = auth\.uid\(\)\)\)/);
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("holds the rules the application relies on: one link per line, estimate and part; a share in range; the three kinds of output; both bases", () => {
    expect(code).toMatch(/unique \(boq_line_id, estimate_id, output\)/);
    expect(code).toMatch(/share_pct numeric\(7,2\) not null default 100 check \(share_pct > 0 and share_pct <= 100\)/);
    expect(code).toMatch(/output = 'total' or output ~ '\^line:/);
    expect(code).toMatch(/output ~ '\^wbs:/);
    expect(code).toMatch(/basis in \('per_unit', 'total'\)/);
    expect(code).toMatch(/boq_line_id uuid not null references tender_boq_lines\(id\) on delete cascade/);
    expect(code).toMatch(/estimate_id uuid not null references estimates\(id\) on delete cascade/);
    for (const col of ["applied_cost", "applied_at", "estimate_updated_at", "needs_review", "review_note", "created_by"]) expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
  });

  it("the three existing tables are widened or extended without losing anything", () => {
    expect(code).toMatch(/alter table estimates add column if not exists opportunity_id uuid references opportunities\(id\) on delete set null/);
    expect(code).toMatch(/alter table rfq_lines add column if not exists estimate_line_id uuid references estimate_lines\(id\) on delete set null/);
    // The old constraint is found by what it checks, then replaced by one that holds every old value plus the new one.
    expect(code).toMatch(/pg_get_constraintdef\(oid\) ilike '%origin_type%'/);
    expect(code).toMatch(/pg_get_constraintdef\(oid\) ilike '%price_source%'/);
    for (const v of ["manual", "standard_quote", "quote", "opportunity", "case", "inspection_report", "work_order", "fence_project", "pricing", "estimate"]) expect(code, v).toContain(`'${v}'`);
    for (const v of ["boq_rate", "bom", "past_project", "supplier", "manual", "estimate"]) expect(code, v).toContain(`'${v}'`);
  });

  it("changes no policy on an existing table and drops nothing but two named check constraints", () => {
    expect(code).not.toMatch(/drop policy if exists "(?!tender_boq_estimate_links)/);
    expect(code).not.toMatch(/drop table|drop column|truncate|delete from/i);
    expect(code).not.toMatch(/alter table opportunities/i);
  });

  it("the bundle carries the migration verbatim, and the ledger lists it as pending", () => {
    const bundle = lf(read("scripts/run-bundle-37-estimates-in-tender-2026-10-26.sql"));
    expect(bundle).toContain(sql.trim());
    const project = read("PROJECT.md");
    expect(project).toMatch(/0227_estimates_in_tender\.sql/);
    expect(project).toMatch(/run-bundle-37-estimates-in-tender-2026-10-26\.sql/);
  });
});

describe("gating and wiring", () => {
  it("the new table is owned by the tender module", () => {
    expect(featureForObject("tender_boq_estimate_links")).toBe("gcc_tender");
  });

  it("the capability text for the edition mentions the estimates, the pricing, the RFQ loop and the budget", () => {
    const doc = read("docs/capabilities/gcc_tender.md");
    expect(doc).toMatch(/Estimates tab/);
    expect(doc).toMatch(/Build up this rate/);
    expect(doc).toMatch(/Allocate to BOQ/);
    expect(doc).toMatch(/Raise RFQ for missing costs/);
    expect(doc).toMatch(/contract project/);
    expect(read("src/lib/capability/facts.generated.json")).toContain("Raise RFQ for missing costs");
  });

  it("every route of the family opens through the one gate and never reads the workspace, the author or a cost from the request", () => {
    const routes = [
      "src/app/api/opportunities/[id]/tender/estimates/links/route.ts", "src/app/api/opportunities/[id]/tender/estimates/links/[linkId]/route.ts", "src/app/api/opportunities/[id]/tender/estimates/build/route.ts",
      "src/app/api/opportunities/[id]/tender/estimates/allocate/route.ts", "src/app/api/opportunities/[id]/tender/estimates/reprice/route.ts", "src/app/api/opportunities/[id]/tender/estimates/missing/route.ts",
      "src/app/api/opportunities/[id]/tender/estimates/route.ts",
    ];
    for (const f of routes) {
      const src = read(f);
      expect(src, f).toMatch(/openEstimatesRequest\(/);
      expect(src, f).not.toMatch(/body\.tenant_id|searchParams\.get\("tenant|body\.created_by|body\.cost|body\.unit_cost|body\.applied_cost|body\.rate\b/);
    }
    const server = read("src/lib/tender/estimates/server.ts");
    expect(server).toMatch(/openTenderDealRequest\(opportunityId, mode !== "view"\)/);
    // The flags are read by the deal gate before any table is touched, and the estimator module after it.
    expect(server.indexOf("openTenderDealRequest(")).toBeLessThan(server.indexOf('tenantOwnsObject(req.tenantId, "estimates")'));
  });

  it("every query on the link table in the application carries the workspace", () => {
    for (const f of walk("src/lib/tender/estimates").filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      const src = read(f);
      for (const m of src.matchAll(/from\("tender_boq_estimate_links"\)([\s\S]{0,400}?)(?:;|\n\s*\n)/g)) {
        // A read, update or delete filters on the workspace; an insert names it.
        expect(m[1], `${f}: ${m[0].slice(0, 80)}`).toMatch(/eq\("tenant_id"|tenant_id: tenantId/);
      }
    }
  });

  it("an estimate can only price lines of the deal it was made for: every lookup chains the deal", () => {
    const server = read("src/lib/tender/estimates/server.ts");
    expect(server).toMatch(/\.eq\("opportunity_id", oppId\)\.maybeSingle\(\)/);
    const budget = read("src/lib/tender/estimates/budgetServer.ts");
    expect(budget).toMatch(/eq\("tenant_id", tenantId\)\.eq\("opportunity_id", opportunityId\)\.in\("id", estimateIds/);
  });

  it("the award reaches the estimate only for an RFQ raised for an estimate, through a dynamic import the standard path never loads", () => {
    const awards = read("src/lib/rfq/awards.ts");
    expect(awards).toMatch(/rfq\.origin_type === "estimate"/);
    expect(awards).toMatch(/await import\("@\/lib\/tender\/estimates\/writeBack"\)/);
    expect(awards).not.toMatch(/^import .*tender\/estimates/m);
    const write = read("src/lib/tender/estimates/writeBack.ts");
    expect(write).toMatch(/\.eq\("estimate_id", args\.rfq\.origin_id\)/);
    expect(write).toMatch(/standard_quote_id/);
  });

  it("the estimate route and the RFQ code treat the new things as optional: no deal, no change", () => {
    const route = read("src/app/api/estimates/route.ts");
    expect(route).toMatch(/\.\.\.\(dealId \? \{ opportunity_id: dealId \} : \{\}\)/);
    expect(route).toMatch(/await import\("@\/lib\/tender\/dealAccess"\)/);
    const rfq = read("src/lib/rfq/server.ts");
    expect(rfq).toMatch(/if \(originType === "estimate"\) await assertEstimateOrigin/);
    expect(rfq).toMatch(/gcc_tender/);
  });
});

describe("a cost never reaches a file or a link a customer can open", () => {
  const WRITERS = [
    "src/lib/tender/boq/write.ts", "src/lib/tender/bids/rules.ts", "src/lib/tender/bids/server.ts", "src/lib/quotePublicLink.ts", "src/lib/salesOrderPublicLink.ts",
    "src/lib/rfq/publicReply.ts", "src/lib/rfq/compose.ts", "src/lib/rfq/sheet.ts",
  ];

  it("the priced Excel, the answer sheet, the bid version snapshot, the public links and what a supplier is sent do not know the estimate modules", () => {
    for (const f of WRITERS) {
      const src = read(f).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src, f).not.toMatch(/tender\/estimates|tender_boq_estimate_links|applied_cost|estimate_line/);
    }
  });

  it("the export functions of the BOQ pass on only the rate and the amount of a line", () => {
    const server = read("src/lib/tender/boq/server.ts");
    const priced = server.slice(server.indexOf("export async function exportPriced"), server.indexOf("export async function exportAnswerSheet"));
    expect(priced).toMatch(/rate: Number\(x\.line\.rate\), amount: Number\(x\.line\.amount\)/);
    expect(priced).not.toMatch(/unit_cost|markup_pct|price_source|estimate/);
    const answer = server.slice(server.indexOf("export async function exportAnswerSheet"), server.indexOf("export function unpricedList"));
    expect(answer).not.toMatch(/unit_cost|markup_pct|estimate/);
  });

  it("an RFQ line sent to a supplier carries wording, unit and quantity only", () => {
    const compose = read("src/lib/rfq/compose.ts");
    expect(compose).not.toMatch(/estimate/i);
    const lines = read("src/lib/tender/estimates/rfqLines.ts");
    expect(lines).not.toMatch(/unit_cost|cost_total|applied_cost/);
  });
});

describe("standard files know nothing of the new things", () => {
  it("the standard deal, quote, RFQ list and estimator maths do not mention the tender estimate links", () => {
    for (const f of [
      "src/app/api/opportunities/route.ts", "src/app/(app)/pipeline/new/NewOpportunityForm.tsx", "src/lib/sales/opportunity.ts", "src/lib/estimator/compute.ts", "src/lib/estimator/template.ts",
      "src/lib/rfq/comparison.ts", "src/lib/rfq/rules.ts", "src/app/api/estimates/[id]/route.ts", "src/app/api/estimates/[id]/lines/route.ts", "src/app/api/estimates/[id]/quote/route.ts",
    ]) {
      expect(read(f), f).not.toMatch(/tender_boq_estimate_links|tender\/estimates/);
    }
  });

  it("the estimator keeps its own routes: only the create route learned about a deal, and only as an optional id", () => {
    for (const f of walk("src/app/api/estimates").filter((x) => x.endsWith("route.ts") && x !== "src/app/api/estimates/route.ts")) {
      expect(read(f), f).not.toMatch(/opportunity_id|gcc_tender/);
    }
  });
});
