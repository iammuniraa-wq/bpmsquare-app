import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// The rules of this module that a later edit could break without any test of behaviour noticing (MULTI_TENANT_GUARDRAILS, bpmsquarecore 7 and 8).

const root = path.resolve(__dirname, "../../..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
};
const lib = walk(path.join(root, "src/lib/connections"));
const routes = walk(path.join(root, "src/app/api/middleware/custom"));
const rel = (p: string) => path.relative(root, p).replace(/\\/g, "/");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("custom connections and endpoints: house rules", () => {
  it("every call to an address a person typed goes through fetchPublic: no bare fetch() anywhere in the module", () => {
    const bare = [...lib, ...routes].filter((f) => /(^|[^.\w])fetch\(/.test(strip(readFileSync(f, "utf8"))));
    expect(bare.map(rel)).toEqual([]);
  });

  it("no console.log, and no secret-bearing value is logged", () => {
    const logs = [...lib, ...routes].filter((f) => /console\.log\(/.test(strip(readFileSync(f, "utf8"))));
    expect(logs.map(rel)).toEqual([]);
  });

  it("every route starts with the middleware guard and never reads a tenant from the request", () => {
    const files = routes.filter((f) => /route\.ts$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).toMatch(/await guard\(\)/);
      expect(src, rel(f)).not.toMatch(/tenant_?id|tenantId/i);
      expect(src, rel(f)).not.toMatch(/createAdminSupabase|requireTenantUser/);
    }
  });

  it("no module code touches tenant_connectors: the existing connectors are not read or written here", () => {
    const hits = [...lib, ...routes].filter((f) => /tenant_connectors/.test(strip(readFileSync(f, "utf8"))));
    expect(hits.map(rel)).toEqual([]);
  });

  it("the stores write only through the service-role client handed in by the guard, with the tenant named", () => {
    for (const f of lib.filter((x) => /(store|endpointOps|ops)\.ts$/.test(x))) {
      const src = strip(readFileSync(f, "utf8"));
      expect(src, rel(f)).not.toMatch(/createAdminSupabase|requireTenantUser/);
      for (const m of src.matchAll(/\.from\((CONNECTIONS_TABLE|ENDPOINTS_TABLE)\)\s*\.(update|delete)\(/g)) {
        // every update or delete statement carries .eq("tenant_id", ...) before it ends
        const tail = src.slice(m.index!, m.index! + 700);
        expect(tail, `${rel(f)} near ${m[0]}`).toMatch(/\.eq\("tenant_id"/);
      }
    }
  });

  it("secrets are sealed on the way in and only unsealed in store.ts", () => {
    for (const f of lib) {
      const src = strip(readFileSync(f, "utf8"));
      if (!/store\.ts$/.test(f)) expect(src, rel(f)).not.toMatch(/unsealSecret|sealSecret|decrypt\(/);
    }
    expect(strip(readFileSync(path.join(root, "src/lib/connections/store.ts"), "utf8"))).toMatch(/sealSecret\(v\)/);
  });
});
