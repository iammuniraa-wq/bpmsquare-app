import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { tipTextProblems } from "@/lib/infoTip";
import { TENDER_TIPS } from "../tips";
import { BOQ_TABLE_TIPS } from "./tips";
import BoqTab, { type BoqScreenState } from "@/components/tender/BoqTab";

// The BOQ tab keeps its section in ?boq= (useUrlTab); a render has no router, so the query string is a variable the test sets.
const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(nav.search) }));

// GCC tender deals, slice 3a: the shape of migration 0223, the bundle that carries it, the ledger, the isolation shape of every
// query, the rule that cost never reaches a file, and that the BOQ screen renders (phone and PC share one flex-wrap layout).

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0223_tender_boq.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const TABLES = ["tender_boq_sources", "tender_boq_lines"];

function walk(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
}

describe("migration 0223", () => {
  it("is idempotent", () => {
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
    expect(code).toMatch(/insert into storage\.buckets .* on conflict \(id\) do nothing/);
  });

  it("every table has tenant_id, RLS and a tenant SELECT policy and NOTHING that writes (0199)", () => {
    for (const t of TABLES) {
      expect(code, t).toMatch(new RegExp(`create table if not exists ${t} \\([^;]*?tenant_id uuid not null references tenants\\(id\\)`));
      expect(code, t).toMatch(new RegExp(`alter table ${t}\\s+enable row level security`));
      const policies = [...code.matchAll(new RegExp(`create policy "([^"]+)" on ${t} for (\\w+)`, "gi"))];
      expect(policies, t).toHaveLength(1);
      expect(policies[0][2].toLowerCase()).toBe("select");
      expect(code, t).toMatch(new RegExp(`on ${t} for select using \\(tenant_id in \\(select tenant_id from tenant_users where user_id = auth\\.uid\\(\\)\\)\\)`));
    }
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("keeps the line link soft, one current source per deal, one row per item key, and the sources the screen names", () => {
    expect(code).toMatch(/line_id uuid references opportunity_lines\(id\) on delete set null/);
    expect(code).toMatch(/create unique index if not exists tender_boq_sources_current_idx on tender_boq_sources \(opportunity_id\) where is_current/);
    expect(code).toMatch(/unique \(opportunity_id, item_key\)/);
    expect(code).toMatch(/price_source in \('boq_rate', 'bom', 'past_project', 'supplier', 'manual'\)/);
    for (const col of ["price_source_ref", "price_as_of", "stale_accepted", "unit_cost", "markup_pct", "row_no", "column_map", "header_row", "removed_in_revision"]) expect(code, col).toContain(col);
  });

  it("adds no column to opportunities or opportunity_lines, and the bucket is private with no storage policy", () => {
    expect(code).not.toMatch(/alter table (if exists )?"?(public"?\.)?opportunit/i);
    expect(code).toMatch(/values \('tender-boq-files', 'tender-boq-files', false, 15728640\)/);
    expect(code).not.toMatch(/on storage\.objects/i);
  });

  it("the bundle carries the migration verbatim, and the ledger lists it as pending", () => {
    const bundle = lf(read("scripts/run-bundle-33-tender-boq-2026-10-26.sql"));
    expect(bundle).toContain(sql.trim());
    expect(bundle).toMatch(/Run bundle 31 \(= 0220\) FIRST/);
    const project = read("PROJECT.md");
    expect(project).toMatch(/0223_tender_boq\.sql -- PENDING/);
    expect(project).toMatch(/run-bundle-33-tender-boq-2026-10-26\.sql/);
  });
});

describe("the BOQ routes", () => {
  const routes = walk("src/app/api/opportunities/[id]/boq").filter((f) => f.endsWith("route.ts"));

  it("every route goes through the one gate and takes nothing about the workspace from the request", () => {
    expect(routes.length).toBe(7);
    for (const f of routes) {
      const src = read(f);
      expect(src, f).toMatch(/openBoqRequest\(/);
      expect(src, f).not.toMatch(/requireTenantUser|createAdminSupabase/);
      expect(src, f).not.toMatch(/body\.(tenant_id|opportunity_id|user_id|priced_by|source_id)|formData\(\)\.get\("tenant/);
    }
    const gate = read("src/lib/tender/boq/server.ts");
    for (const flag of ["gcc_tender", "pipeline"]) expect(gate).toContain(`"${flag}"`);
    expect(gate).toMatch(/canViewWorkcenter\(perms, "pipeline"\)/);
    expect(gate).toMatch(/canEditWorkcenter\(perms, "pipeline"\)/);
    expect(gate).toMatch(/loadOpportunity\(admin, tenantId, opportunityId\)/);
    // Writes need edit access; reads do not.
    for (const f of routes.filter((r) => /preview|price|boq\/route/.test(r) && !/candidates|export/.test(r))) expect(read(f), f).toMatch(/openBoqRequest\(id, (true|false)\)/);
    expect(read("src/app/api/opportunities/[id]/boq/export/route.ts")).toMatch(/openBoqRequest\(id, false\)/);
    expect(read("src/app/api/opportunities/[id]/boq/price/route.ts")).toMatch(/openBoqRequest\(id, true\)/);
    // The row panel's quantity / description route is a write, takes the row id from the path only, and never touches what the file said.
    const lineRoute = read("src/app/api/opportunities/[id]/boq/lines/[boqId]/route.ts");
    expect(lineRoute).toMatch(/openBoqRequest\(id, true\)/);
    expect(lineRoute).toMatch(/editBoqLine\(gate\.req, boqId, \{ qty: body\.qty, description: body\.description \}\)/);
    const edit = read("src/lib/tender/boq/server.ts");
    const editPart = edit.slice(edit.indexOf("export async function editBoqLine"), edit.indexOf("export type PriceAllResult"));
    expect(editPart).not.toMatch(/file_qty|file_description|file_uom|file_rate/);
  });

  it("every query on a BOQ table, or on the sources it reads, carries the workspace filter", () => {
    const files = ["src/lib/tender/boq/server.ts", "src/lib/tender/boq/sources.ts"];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/\.from\("([a-z_]+)"\)[^;]*?;\n/g)) {
        if (m[1] === "tenants") continue; // read by its own id
        if (/\.insert\(/.test(m[0])) continue; // the inserted rows are checked below: each carries tenant_id
        expect(m[0], `${f}: ${m[0].slice(0, 100)}`).toMatch(/tenant_id|tenantId/);
      }
    }
  });

  it("every row the server inserts names the workspace explicitly", () => {
    const src = read("src/lib/tender/boq/server.ts");
    // new deal lines, new BOQ rows, the new source row
    expect(src.match(/tenant_id: tenantId/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/id: sourceId, tenant_id: tenantId, opportunity_id: opp\.id/);
    expect(src).toMatch(/\{ id, tenant_id: tenantId, opportunity_id: opp\.id, sl_no/);
    expect(src).toMatch(/id: randomUUID\(\), tenant_id: tenantId, opportunity_id: opp\.id, line_id/);
  });

  it("cost, markup and margin never reach a file: the writers are given a rate and an amount and nothing else", () => {
    const write = read("src/lib/tender/boq/write.ts");
    const body = write.replace(/\/\/[^\n]*/g, "");
    expect(body).not.toMatch(/unit_cost|markup|margin|cost_price/i);
    const server = read("src/lib/tender/boq/server.ts");
    const exportPart = server.slice(server.indexOf("export async function exportPriced"));
    expect(exportPart.replace(/\/\/[^\n]*|\/\*\*[\s\S]*?\*\//g, "")).not.toMatch(/unit_cost|markup/);
  });

  it("a price is never taken from the request except a manual rate", () => {
    const route = read("src/app/api/opportunities/[id]/boq/price/route.ts");
    expect(route).not.toMatch(/body\.price\b|body\.unit_cost|body\.cost\b/);
    expect(read("src/lib/tender/boq/server.ts")).toMatch(/candidatesFor\(ctx, sourceLine\(\{ boq, line \}\)\)\.find\(\(c\) => c\.source === body\.source && c\.ref === \(body\.ref \?\? ""\)\)/);
  });

  it("no console.log, and the standard files know nothing of the BOQ", () => {
    for (const f of [...walk("src/lib/tender/boq").filter((x) => /\.tsx?$/.test(x) && !x.endsWith(".test.ts")), "src/components/tender/BoqTab.tsx", ...routes]) expect(read(f), f).not.toMatch(/console\.log/);
    for (const f of ["src/app/api/opportunities/route.ts", "src/app/(app)/pipeline/new/NewOpportunityForm.tsx", "src/lib/sales/opportunity.ts", "src/lib/sales/opportunityServer.ts"]) {
      expect(read(f), f).not.toMatch(/tender_boq|BoqTab|tender\/boq/);
    }
    // The only change to the standard Lines route is the guard that stops it deleting lines it cannot keep.
    expect(read("src/app/api/opportunities/[id]/lines/route.ts")).toMatch(/beforeLines\.length > 200/);
  });
});

describe("the wiring that applies (3b)", () => {
  it("OBJECT_FEATURE says the BOQ tables belong to gcc_tender", () => {
    for (const k of ["tender_boq_sources", "tender_boq_lines"]) expect(featureForObject(k), k).toBe("gcc_tender");
  });

  it("the capability document describes the BOQ and the stale-price rule", () => {
    const doc = read("docs/capabilities/gcc_tender.md");
    expect(doc).toMatch(/Bill of quantities reads the client's Excel/);
    expect(doc).toMatch(/never applied automatically/);
    expect(doc).toMatch(/Cost and margin never appear/);
  });

  it("the validity setting lives on the Tenders settings screen only", () => {
    expect(read("src/app/(app)/settings/tenders/TendersSettingsClient.tsx")).toMatch(/data-guide="tender\.settings\.price_validity"/);
    expect(read("src/lib/constants.ts")).toMatch(/price_validity_days\?: number/);
    // Not repeated on the deal or the BOQ screens: they read the limit from the server's state.
    for (const f of [...walk("src/app/(app)/pipeline"), ...walk("src/app/api/opportunities")].filter((x) => /\.(tsx?)$/.test(x) && !x.endsWith(".test.ts"))) {
      expect(read(f), f).not.toMatch(/price_validity_days/);
    }
    expect(read("src/components/tender/BoqTab.tsx")).not.toMatch(/price_validity_days/);
  }, 30_000);

  it("every BOQ explanation fits behind an i, and the screen carries data-guide ids", () => {
    for (const [k, v] of Object.entries(TENDER_TIPS).filter(([k]) => k.startsWith("boq") || k === "priceValidity")) expect(tipTextProblems(v), k).toEqual([]);
    const files = ["BoqTab", "BoqUpload", "BoqRows", "BoqRowPanel", "BoqDownloads"].map((f) => `src/components/tender/${f}.tsx`);
    const ids = new Set(files.flatMap((f) => [...read(f).matchAll(/"(boq\.[a-z_.]+)"/g)].map((m) => m[1])));
    for (const id of ["boq.tab", "boq.toolbar", "boq.upload", "boq.file", "boq.preview", "boq.sheet", "boq.header_row", "boq.apply", "boq.cancel", "boq.diff", "boq.markup", "boq.price_all", "boq.summary", "boq.filters", "boq.table", "boq.cards", "boq.line", "boq.open_row", "boq.chips", "boq.source", "boq.show_more", "boq.row", "boq.row.save", "boq.row.qty", "boq.row.rate", "boq.row.description", "boq.row.cost", "boq.row.costing", "boq.price_line", "boq.picker", "boq.candidate", "boq.download", "boq.answer_sheet"]) {
      expect(ids, id).toContain(id);
    }
    for (const [k, v] of Object.entries(BOQ_TABLE_TIPS)) expect(tipTextProblems(v), k).toEqual([]);
  });
});

describe("the Bill of quantities screen (the rows, chips and panel are tested in BillOfQuantities.render.test.ts)", () => {
  const html = (s: BoqScreenState) => {
    nav.search = "";
    return renderToString(createElement(BoqTab, { opportunityId: "o1", canEdit: true, onError: () => {}, onNotice: () => {}, initialData: s })).replace(/<!-- -->/g, "");
  };
  const empty = (over: Partial<BoqScreenState> = {}): BoqScreenState => ({
    pending: false, source: null, lines: [], validity_days: 180, today: "2026-10-26", default_markup_pct: 15,
    totals: { lines: 0, priced: 0, unpriced: 0, stale: 0, amount: 0 }, unpriced: [], ...over,
  } as BoqScreenState);

  it("before any upload it offers the upload and nothing else, and a pending migration says so", () => {
    const out = html(empty());
    expect(out).toContain("Upload BOQ (.xlsx)");
    expect(out).toContain("No Bill of quantities yet");
    expect(out).not.toContain("Price all lines");
    expect(out).not.toContain("<table");
    expect(html(empty({ pending: true }))).toContain("migration 0223");
  });

  it("tells the page when the deal's lines changed, so the header and totals are reloaded", () => {
    const src = read("src/components/tender/BoqTab.tsx");
    expect(src).toMatch(/onLinesChanged\?: \(\) => void/);
    // One reload path: the table, the estimates and the page. Every place the lines change (upload, price all, match, the row panel) goes through it.
    expect(src).toMatch(/reloadAfterSave<State>\(base, setData, onLinesChanged\)/);
    expect(src.match(/onChanged=\{changed\}/g)?.length ?? 0).toBe(2);
    // Lines typed by hand (no client file) save through the same reload path.
    expect(src).toMatch(/<DealLinesBoq[\s\S]*onChanged=\{\(\) => onLinesChanged\?\.\(\)\}/);
    expect(src).toMatch(/onApplied: \(\) => \{ setShown\(0\); changed\(\); \}/);
    expect(src).toMatch(/changed\(\);\r?\n\s*\}\r?\n\r?\n\s*if \(!data\)/);
    expect(read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx")).toMatch(/onLinesChanged=\{\(\) => router\.refresh\(\)\}/);
  });
});
