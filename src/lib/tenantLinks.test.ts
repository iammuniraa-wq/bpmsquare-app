import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { tenantOrigin, PRIMARY_HOST } from "./constants";

// Guard against the P1 of 2026-09-06: a WFM correction-request email sent to
// a BIM supervisor linked to app.bpmsquare.com (the demo) because the link
// was built from PRIMARY_HOST. Any link that leaves the system must be built
// from the tenant's own domain via tenantOrigin(); this test fails the build
// if a source file interpolates PRIMARY_HOST into a URL again.

const SRC = join(__dirname, "..");
const ALLOWED = new Set(["lib/constants.ts"]);
const FORBIDDEN = [/https?:\/\/\$\{PRIMARY_HOST\}/, /PRIMARY_HOST\}\//];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("tenantOrigin", () => {
  it("uses the tenant's own domain", () => {
    expect(tenantOrigin("bim.bpmsquare.com")).toBe("https://bim.bpmsquare.com");
    expect(tenantOrigin(" vikas.bpmsquare.com ")).toBe("https://vikas.bpmsquare.com");
  });
  it("falls back to the shared host only when there is no custom domain", () => {
    expect(tenantOrigin(null)).toBe(`https://${PRIMARY_HOST}`);
    expect(tenantOrigin("")).toBe(`https://${PRIMARY_HOST}`);
  });
});

describe("no outbound link is built from PRIMARY_HOST", () => {
  it("every source file goes through tenantOrigin()", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      if (FORBIDDEN.some((re) => re.test(text))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
