import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { csvCell } from "./template";

// Audit 2026-10-21 (M4): two CSV writers (Reports quotes.csv, the platform-admin tenant export)
// wrote tenant-typed text without neutralising a leading = + - @, which Excel runs as a formula.

describe("csvCell", () => {
  it.each(["=HYPERLINK(\"http://x\",\"y\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"])("neutralises %j", (v) => {
    expect(csvCell(v).replace(/^"/, "")).toMatch(/^'/);
  });

  it("quotes values that need it and leaves plain text alone", () => {
    expect(csvCell("Acme, Inc.")).toBe("\"Acme, Inc.\"");
    expect(csvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(csvCell("Plain name")).toBe("Plain name");
    expect(csvCell("")).toBe("");
  });
});

describe("CSV writers that carry tenant text use it", () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, "../../..", rel), "utf8");

  it("Reports quotes.csv", () => {
    const src = read("src/app/(app)/reports/ReportsClient.tsx");
    expect(src).toMatch(/import \{ csvCell \} from "@\/lib\/import\/template"/);
    expect(src).not.toMatch(/`"\$\{r\.account\.name\}"`/);
  });

  it("the platform-admin tenant export", () => {
    const src = read("src/app/api/admin/tenants/[id]/export/route.ts");
    expect(src).toMatch(/csvCell\(s\)/);
  });
});
