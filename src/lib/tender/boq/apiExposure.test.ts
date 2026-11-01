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
