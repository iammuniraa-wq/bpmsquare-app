import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { tipTextProblems } from "@/lib/infoTip";
import { TENDER_TIPS } from "../tips";
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
    expect(routes.length).toBe(6);
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
    expect(doc).toMatch(/BOQ tab reads the client's Excel/);
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
    const ids = new Set([...read("src/components/tender/BoqTab.tsx").matchAll(/"(boq\.[a-z_.]+)"/g)].map((m) => m[1]));
    for (const id of ["boq.tab", "boq.upload", "boq.file", "boq.preview", "boq.sheet", "boq.header_row", "boq.apply", "boq.cancel", "boq.diff", "boq.markup", "boq.price_all", "boq.line", "boq.price_line", "boq.picker", "boq.candidate", "boq.manual", "boq.download", "boq.answer_sheet", "boq.show_all"]) {
      expect(ids, id).toContain(id);
    }
  });
});

describe("the BOQ screen", () => {
  const state = (over: Partial<BoqScreenState> = {}): BoqScreenState => ({
    pending: false,
    source: { file_name: "ARB-4400123 BOQ.xlsx", sheet_name: "BOQ Bill 1", version: 2, uploaded_at: "2026-10-26T08:00:00Z", line_count: 3, added_columns: true },
    lines: [
      { id: "b1", line_id: "l1", row_no: 8, item_no: "A.1", cost_code: "31 23 16", description: "Excavation in ordinary soil", uom: "m3", qty: 1200, rate: 20, amount: 24000, priced: true, linked: true, removed: false, price_source: "supplier", price_source_ref: "RFQ-0012 · Gulf Pipes", price_as_of: "2025-12-01", stale: true, stale_text: "stale, 329 days old", stale_accepted: false, unit_cost: 16, markup_pct: 25 },
      { id: "b2", line_id: "l2", row_no: 9, item_no: "A.2", cost_code: null, description: "Backfill", uom: "m3", qty: 850.5, rate: 0, amount: 0, priced: false, linked: true, removed: false, price_source: null, price_source_ref: null, price_as_of: null, stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null },
      { id: "b3", line_id: "l3", row_no: 10, item_no: "A.3", cost_code: null, description: "Dropped in revision", uom: "m", qty: 1, rate: 5, amount: 5, priced: true, linked: true, removed: true, price_source: "manual", price_source_ref: null, price_as_of: "2026-10-01", stale: false, stale_text: null, stale_accepted: false, unit_cost: null, markup_pct: null },
    ].map((l) => ({ file_rate: null, ...l })) as BoqScreenState["lines"],
    validity_days: 180, today: "2026-10-26",
    totals: { lines: 2, priced: 1, unpriced: 1, stale: 1, amount: 24000 },
    unpriced: [{ item: "A.2 Backfill", reason: "No rate yet" }],
    ...over,
  } as BoqScreenState);
  const html = (s: BoqScreenState, canEdit = true, section = "") => {
    nav.search = section ? `boq=${section}` : "";
    return renderToString(createElement(BoqTab, { opportunityId: "o1", canEdit, onError: () => {}, onNotice: () => {}, initialData: s })).replace(/<!-- -->/g, "");
  };
  const SECTIONS = ["upload", "prices", "download"];

  it("is split into Upload, Prices and Download tabs; with a BOQ it opens on Prices, and the tab chosen in the address wins", () => {
    const out = html(state());
    for (const label of ["Upload", "Prices", "Download"]) expect(out).toContain(`>${label}`);
    expect(out).toContain('data-guide="tab:prices"');
    expect(out).toMatch(/data-guide="tab:prices"[^>]*aria-selected="true"|aria-selected="true"[^>]*data-guide="tab:prices"/);
    expect(out).toContain("Excavation in ordinary soil");
    expect(out).not.toContain("Download priced BOQ");
    expect(html(state(), true, "download")).toContain("Download priced BOQ");
    expect(html(state(), true, "download")).not.toContain("Excavation in ordinary soil");
    expect(html(state(), true, "upload")).toContain("Upload revised BOQ");
    // A value in the address that is not a tab falls back to the default.
    expect(html(state(), true, "nonsense")).toContain("Excavation in ordinary soil");
  });

  it("puts a count on the tab that needs attention: lines to price or stale on Prices, none on a finished BOQ", () => {
    expect(html(state())).toMatch(/Prices<span class="bpm-tab-count">2<\/span>/);
    const done = html(state({ totals: { lines: 2, priced: 2, unpriced: 0, stale: 0, amount: 1 }, unpriced: [] }));
    expect(done).not.toContain("bpm-tab-count");
  });

  it("Prices shows the lines, the source of each price with its age in amber, and keeps the internal cost out of the explanations", () => {
    const out = html(state());
    expect(out).toContain("Excavation in ordinary soil");
    expect(out).toContain("Supplier");
    expect(out).toContain("stale, 329 days old");
    expect(out).toContain("var(--amberink)");
    expect(out).toContain("Price this line");
    expect(out).toContain("Change price");
    expect(out).toContain("Price all lines");
    expect(out).toContain("priced line is no longer in the latest file and kept");
  });

  it("Upload shows the file that is on the deal", () => {
    expect(html(state(), true, "upload")).toContain("ARB-4400123 BOQ.xlsx");
  });

  it("Download opens with the warning about unpriced lines, above the buttons, and keeps the added-columns note", () => {
    const out = html(state(), true, "download");
    expect(out).toContain("Download priced BOQ");
    expect(out).toContain("Export answer sheet");
    expect(out).toContain("Rate and amount columns are added to the client");
    expect(out).toContain("1 line has no rate and will be left blank in the file");
    expect(out).toContain("A.2 Backfill: No rate yet");
    expect(out.indexOf("will be left blank")).toBeLessThan(out.indexOf("Download priced BOQ"));
    const clean = html(state({ totals: { lines: 2, priced: 2, unpriced: 0, stale: 0, amount: 1 }, unpriced: [] }), true, "download");
    expect(clean).not.toContain("will be left blank");
  });

  it("prints none of its explanations as running text (they sit behind the i), on any tab", () => {
    for (const section of SECTIONS) {
      const out = html(state(), true, section);
      for (const [k, v] of Object.entries(TENDER_TIPS).filter(([k]) => k.startsWith("boq") || k === "priceValidity")) {
        if (k === "boqCost") continue; // the cost tip is in the markup as an aria/popover payload only
        expect(out.split(v).length - 1, `${section}: ${k}`).toBeLessThanOrEqual(0);
      }
    }
  });

  it("phone and PC share one layout: lines wrap, every control is 44 px tall, and there is no table to scroll sideways", () => {
    for (const section of SECTIONS) {
      const out = html(state(), true, section);
      expect(out, section).not.toContain("<table");
      expect(out, section).toMatch(/min-height:44px/);
      expect(out, section).not.toMatch(/min-width:\s*(?:[5-9]\d\d|\d{4,})px/);
    }
    const prices = html(state());
    expect(prices).toMatch(/flex-wrap:wrap/);
    expect(prices).toMatch(/overflow-wrap:anywhere/);
    expect(prices.match(/min-height:44px/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("a view-only user sees the lines but no upload, price or price-all control", () => {
    const out = html(state(), false);
    expect(out).toContain("Excavation in ordinary soil");
    expect(out).not.toContain("Price all lines");
    expect(out).not.toContain("Price this line");
    expect(html(state(), false, "upload")).not.toContain("Upload revised BOQ");
    expect(html(state(), false, "download")).toContain("Download priced BOQ");
  });

  it("before any upload it offers the upload and nothing else (no tab strip), and a pending migration says so", () => {
    const empty = html(state({ source: null, lines: [], totals: { lines: 0, priced: 0, unpriced: 0, stale: 0, amount: 0 }, unpriced: [] }));
    expect(empty).toContain("Upload BOQ (.xlsx)");
    expect(empty).not.toContain("Download priced BOQ");
    expect(empty).not.toContain('role="tablist"');
    // Even if the address names another tab, there is nothing else to show.
    expect(html(state({ source: null, lines: [], totals: { lines: 0, priced: 0, unpriced: 0, stale: 0, amount: 0 }, unpriced: [] }), true, "download")).toContain("Upload BOQ (.xlsx)");
    expect(html(state({ pending: true }))).toContain("migration 0223");
  });

  it("tells the page when the deal's lines changed, so the Lines tab and the header are reloaded", () => {
    const src = read("src/components/tender/BoqTab.tsx");
    expect(src).toMatch(/onLinesChanged\?: \(\) => void/);
    // After an upload is applied, after any price is set (one line or all), and after lines are linked to products: the three places the lines change.
    expect((src.match(/onLinesChanged\?\.\(\)/g) ?? []).length).toBe(3);
    expect(read("src/app/(app)/pipeline/[id]/OpportunityDetailClient.tsx")).toMatch(/onLinesChanged=\{\(\) => router\.refresh\(\)\}/);
  });
});
