import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Who supplies a product (supplier_id, 0132) and what it costs (cost_price) are
// commercially sensitive. Every machine surface selects explicit columns, so the
// protection is the absence of the name from those selects -- this pins it.
const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

/** The text of every `.select("...")` that follows `.from("products")`. */
function productSelects(source: string): string[] {
  return [...source.matchAll(/\.from\("products"\)\s*\.select\(\s*"([^"]*)"/g)].map((m) => m[1]);
}

describe("products stay free of internal columns on every machine surface", () => {
  const files = [
    "src/lib/api/listSources.ts",
    "src/app/api/v1/products/route.ts",
    "src/app/api/v1/products/[id]/route.ts",
  ];

  it("finds the product selects it is meant to guard", () => {
    const all = files.flatMap((f) => productSelects(read(f)));
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it.each(files)("%s never selects supplier or cost columns", (file) => {
    for (const cols of productSelects(read(file))) {
      expect(cols).not.toMatch(/supplier/i);
      expect(cols).not.toMatch(/cost/i);
      expect(cols).not.toBe("*");
    }
  });

  it("BOM structure (product_bom_lines) is not read by any machine surface", () => {
    const sources = ["src/lib/api/listSources.ts", "src/app/api/v1/products/route.ts", "src/app/api/v1/products/[id]/route.ts"];
    for (const f of sources) expect(read(f)).not.toMatch(/product_bom_lines/);
    const mcp = read("mcp-server/mcp.json");
    expect(mcp).not.toMatch(/bom_lines|BOM components|rolled-up/i);
  });

  it("the MCP product tools do not mention a supplier", () => {
    const mcp = JSON.parse(read("mcp-server/mcp.json")) as { tools: { name: string; description: string }[] };
    for (const t of mcp.tools.filter((x) => x.name === "list_products" || x.name === "get_product")) {
      expect(t.description).not.toMatch(/supplier/i);
    }
  });
});
