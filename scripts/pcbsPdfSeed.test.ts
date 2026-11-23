import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildPcbsSeedSql, PCBS_BLOCKS, PCBS_PDF_DESIGN } from "./pcbs-pdf-design.data";
import { sanitizePdfDesign } from "../src/lib/pdf/design";

// scripts/seed-pcbs-pdf-design.sql is GENERATED from pcbs-pdf-design.data.ts. This test fails if the two drift apart, so the data
// that PCBS gets is the data that is tested and rendered. Regenerate with: WRITE_SEED=1 npx vitest run scripts/pcbsPdfSeed.test.ts

const file = path.join(__dirname, "seed-pcbs-pdf-design.sql");

describe("seed-pcbs-pdf-design.sql", () => {
  it("is exactly what the data file generates", () => {
    if (process.env.WRITE_SEED === "1") fs.writeFileSync(file, buildPcbsSeedSql(), "utf8");
    expect(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).toBe(buildPcbsSeedSql());
  });

  it("is idempotent, scoped to the pcbs slug, and creates no entity or customer data", () => {
    const sql = buildPcbsSeedSql();
    expect(sql).toContain("where slug = 'pcbs'");
    expect(sql).toContain("on conflict (tenant_id, name) do update");
    expect(sql).toMatch(/if t is null then/);
    expect(sql).not.toMatch(/insert into (tenants|accounts|contacts)/i);
    expect(sql).not.toMatch(/delete\s+from/i);
  });

  it("holds a frame the sanitizer accepts as it stands", () => {
    expect(sanitizePdfDesign(PCBS_PDF_DESIGN)).toEqual(PCBS_PDF_DESIGN);
    expect(PCBS_BLOCKS.filter((b) => b.type === "clause_section").length).toBeGreaterThanOrEqual(8);
  });
});
