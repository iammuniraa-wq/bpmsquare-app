import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TENDER_BOQ_LINE_FIELDS } from "./apiRows";

// What a tender's Bill of quantities shows a machine: the line, our unit rate and amount, where the rate came from and its status.
// What it never shows: unit_cost and markup_pct (what we pay and the margin on it), price_source_ref (names the supplier / RFQ / past
// deal) and who priced it. Every machine surface reads explicit columns, so the protection is the absence of the names from those
// selects and from the field whitelist: this pins it, the way productApiExposure.test.ts does for products.
const root = path.resolve(__dirname, "../../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
// stale_accepted is read (it decides a line's status) but never returned, so only the output side lists it.
const INTERNAL = /unit_cost|markup|price_source_ref|priced_by|priced_at|cost_price|margin/i;

/** Every column list that follows `.from("<table>").select(`: a string literal, or the name of a const that holds one. */
function selects(source: string, table: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(new RegExp(`\\.from\\("${table}"\\)\\s*\\.select\\(\\s*(?:"([^"]*)"|([A-Z_]+))`, "g"))) {
    if (m[1] != null) out.push(m[1]);
    else {
      const def = new RegExp(`const ${m[2]}\\s*=\\s*\\n?\\s*"([^"]*)"`).exec(source);
      out.push(def ? def[1] : `UNRESOLVED ${m[2]}`);
    }
  }
  return out;
}

describe("part 1: the shared loader reads no internal column", () => {
  const src = read("src/lib/tender/boq/apiRows.ts");

  it("finds the selects it guards, and none is internal, unresolved or a star", () => {
    const lines = selects(src, "tender_boq_lines");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const cols of [...lines, ...selects(src, "tender_boq_sources"), ...selects(src, "opportunity_lines")]) {
      expect(cols).not.toMatch(INTERNAL);
      expect(cols).not.toContain("*");
      expect(cols).not.toMatch(/UNRESOLVED/);
    }
    expect(lines[0]).toContain("file_description");
  });

  it("the loader's output keys are exactly the whitelisted fields", () => {
    const body = src.slice(src.indexOf("out.push({"), src.indexOf("return { source, rows: out }"));
    const keys = [...body.matchAll(/^\s{6}([a-z_]+)[:,]/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual(TENDER_BOQ_LINE_FIELDS.map((f) => f.path).sort());
  });

  it("the field whitelist names no internal path", () => {
    for (const f of TENDER_BOQ_LINE_FIELDS) expect(f.path, f.path).not.toMatch(/stale_accepted|line_id|source_id|item_key|^tenant_id$|^markup|margin|^unit_cost|price_source_ref|priced_/);
  });

  it("every query carries the workspace and the tender", () => {
    for (const m of src.matchAll(/\.from\("([a-z_]+)"\)[^;]*?;\n/g)) {
      if (m[1] === "tenants") continue;
      expect(m[0], m[0].slice(0, 90)).toMatch(/tenant_id/);
    }
    for (const t of ["tender_boq_sources", "tender_boq_lines", "opportunity_lines"]) {
      const q = new RegExp(`\\.from\\("${t}"\\)[^\\n]*`).exec(src)![0];
      expect(q, t).toMatch(/\.eq\("opportunity_id", opportunityId\)/);
    }
  });
});

describe("part 2: the v1 routes, Talk to data, the keys panel and the change feed", () => {
  const routes = ["src/app/api/v1/tenders/route.ts", "src/app/api/v1/tenders/[id]/route.ts", "src/app/api/v1/tenders/[id]/boq/route.ts", "src/app/api/v1/tenders/[id]/wbs/route.ts"];

  it("every v1 tender route authorizes through the explicit tenders scope, checks the Pipeline, and names the workspace on every query", () => {
    for (const f of routes) {
      const src = read(f);
      expect(src, f).toMatch(/authorizeApi\(req, "tenders"\)/);
      expect(src, f).toMatch(/tenantHasFeature\(.*"pipeline"\)/);
      expect(src, f).not.toMatch(/requireTenantUser|resolveTenantFromBearer/);
      for (const m of src.matchAll(/\.from\("([a-z_]+)"\)[^;]*?;\n/g)) expect(m[0], `${f}: ${m[0].slice(0, 80)}`).toMatch(/tenant_id/);
      for (const cols of [...selects(src, "tender_boq_lines"), ...selects(src, "opportunity_tenders")]) {
        expect(cols).not.toMatch(INTERNAL);
        expect(cols).not.toContain("*");
      }
    }
  });

  it("Talk to data: the BOQ source reads only through the shared loader, and asking for it needs the tenders scope", () => {
    const src = read("src/lib/api/listSources.ts");
    const block = src.slice(src.indexOf("  tender_boq_lines: {"), src.indexOf("  projects: {"));
    expect(block).toContain("fields: TENDER_BOQ_LINE_FIELDS");
    expect(block).toContain("loadBoqRowsForApi(");
    expect(block).not.toMatch(/\.from\("tender_boq_lines"\)|unit_cost|markup_pct|price_source_ref/);
    expect(src.indexOf("  tender_boq_lines: {")).toBeGreaterThan(src.indexOf("  estimates: {"));
    expect(read("src/app/api/v1/ask/route.ts")).toMatch(/object === "tender_boq_lines" \? "tenders" : object/);
  });

  it("a key can be minted with the scope, the index and the registry name the endpoints, and the scope stays explicit-only", () => {
    expect(read("src/app/(app)/settings/developer/ApiKeysPanel.tsx")).toMatch(/key: "tenders", label: "Tenders \(bids and BOQ rates, no costs\)"/);
    const index = read("src/app/api/v1/route.ts");
    for (const e of ["GET /api/v1/tenders\"", "GET /api/v1/tenders/:id\"", "GET /api/v1/tenders/:id/boq\"", "GET /api/v1/tenders/:id/wbs\""]) expect(index, e).toContain(e);
    expect(read("src/lib/api/registry.ts")).toContain('"/api/v1/tenders"');
    expect(read("src/lib/api/openapi.ts")).toContain('paths["/tenders/{id}/boq"]');
    expect(read("src/lib/api/openapi.ts")).toContain('paths["/tenders/{id}/wbs"]');
    expect(read("src/app/api/v1/_auth.ts")).toMatch(/EXPLICIT_SCOPE_ONLY = new Set\([^)]*"tenders"/);
  });
});

describe("part 3: the MCP manifest", () => {
  const mcp = JSON.parse(read("mcp-server/mcp.json")) as { version: string; tools: { name: string; description: string; method: string; path: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }[] };
  const tools = ["list_tenders", "get_tender", "get_tender_boq", "get_tender_wbs"].map((n) => mcp.tools.find((t) => t.name === n));

  it("is version 1.21.0 with the four tender tools, each a GET on the v1 endpoint it names", () => {
    expect(mcp.version).toBe("1.21.0");
    expect(tools.every(Boolean)).toBe(true);
    expect(tools.map((t) => `${t!.method} ${t!.path}`)).toEqual(["GET /api/v1/tenders", "GET /api/v1/tenders/{id}", "GET /api/v1/tenders/{id}/boq", "GET /api/v1/tenders/{id}/wbs"]);
    expect(tools[3]!.inputSchema.required).toEqual(["id"]);
    expect(new Set(mcp.tools.map((t) => t.name)).size).toBe(mcp.tools.length);
    expect(tools[1]!.inputSchema.required).toEqual(["id"]);
    expect(tools[2]!.inputSchema.required).toEqual(["id"]);
    expect(Object.keys(tools[0]!.inputSchema.properties!)).toEqual(["stage", "outcome", "decision", "portal", "closing"]);
  });

  it("each tells the model the key must be scoped to tenders, and none describes a cost, a markup or a supplier name as returned", () => {
    for (const t of tools) {
      expect(t!.description, t!.name).toContain('scoped to \\"tenders\\"'.replace(/\\"/g, '"'));
      // Every mention of the internal data is a promise that it is NOT returned.
      for (const sentence of t!.description.split(/(?<=\.)\s+/)) {
        if (/\b(costs?|markup|margin|supplier names?)\b/i.test(sentence) && !/cost code/i.test(sentence.replace(/never returned/i, ""))) expect(sentence, `${t!.name}: ${sentence}`).toMatch(/never returned/);
      }
      expect(JSON.stringify(t!.inputSchema), t!.name).not.toMatch(/unit_cost|markup|price_source_ref/);
    }
  });

  it("the manifest keeps the product-structure words out, as productApiExposure.test.ts requires", () => {
    expect(read("mcp-server/mcp.json")).not.toMatch(/bom_lines|BOM components|rolled-up/i);
  });
});

describe("part 4: the WBS endpoint and the WBS columns show client amounts only", () => {
  it("the WBS answer is built from the customer-safe BOQ rows, never from a query of its own on the lines", () => {
    const api = read("src/lib/tender/wbs/api.ts");
    expect(api).toContain("loadBoqRowsForApi(");
    expect(api).not.toMatch(/\.from\(|unit_cost|markup|price_source_ref|cost_price/);
    const shape = read("src/lib/tender/wbs/apiShape.ts");
    expect(shape).not.toMatch(/\.from\(|unit_cost|markup_pct|price_source_ref|cost_price/);
    // The roll-up is handed no unit cost at all, so its cost figure stays null and is never read into the answer.
    expect(shape).toContain("cost: null");
    expect(shape).not.toMatch(/\bf\??\.cost\b/);
  });

  it("the rows the structure comes from (items, line memberships, parts) hold no cost column", () => {
    const readSrc = read("src/lib/tender/wbs/read.ts");
    for (const table of ["tender_wbs_items", "tender_boq_lines", "tender_wbs_line_parts"]) {
      for (const cols of selects(readSrc, table)) {
        expect(cols).not.toMatch(INTERNAL);
        expect(cols).not.toContain("*");
      }
    }
  });

  it("the endpoint's fields name no internal path and no employee id", () => {
    const shape = read("src/lib/tender/wbs/apiShape.ts");
    const block = shape.slice(shape.indexOf("export const TENDER_WBS_FIELDS"), shape.indexOf("/** The slice of an already-loaded"));
    expect(block).not.toMatch(/cost|markup|margin|owner_employee_id|unit_cost|price_source/i);
  });

  it("a split line's part carries a share, a quantity and a client amount, and the BOQ fields name the two WBS columns", () => {
    const names = TENDER_BOQ_LINE_FIELDS.map((f) => f.path);
    expect(names).toContain("wbs_code");
    expect(names).toContain("wbs_parts");
    const shape = read("src/lib/tender/wbs/apiShape.ts");
    expect(shape).toContain("export type ApiLinePart = { wbs_code: string; share_pct: number; quantity: number; amount: number | null };");
  });
});
