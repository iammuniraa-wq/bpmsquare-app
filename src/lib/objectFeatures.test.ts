import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OBJECT_FEATURE, featureForObject } from "./objectFeatures";
import { LIST_SOURCES } from "./api/listSources";

// The gate that stopped being strong once, on 2026-09-22: the snasquare
// workspace owned none of Cases, Contacts, Assets or Quotations and saw all
// four on its Account page, because four surfaces each decided separately
// which objects a tenant may reach. These tests are the thing that keeps the
// answer in one place -- they fail the build when a new object, a new Data
// Workbench route or a new v1 endpoint arrives without a module behind it.

const API = join(__dirname, "..", "app", "api");
const DW_MODES = ["import", "export", "update"] as const;
// Not object routes: /import/extract is the AI column-matcher, /import/template
// generates a blank file. Neither reads or writes tenant records.
const NOT_OBJECTS = new Set(["extract", "template"]);
// Meta endpoints: they describe the API rather than serve an object, and
// resolve their tenant through resolveTenantFromBearer, not authorizeApi.
const V1_META = new Set(["_auth.ts", "_list.ts", "route.ts", "metadata", "openapi.json", "changes", "ask"]);

const objectDirs = (mode: string): string[] =>
  readdirSync(join(API, mode), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !NOT_OBJECTS.has(e.name))
    .map((e) => e.name);

describe("OBJECT_FEATURE", () => {
  it("only names real TenantFeatures keys", () => {
    // TenantFeatures is a type, so it is gone at runtime -- read the keys out
    // of the source the same way tenantLinks.test.ts reads source for its own
    // guard. A typo'd key would otherwise gate on a flag that is always false.
    const src = readFileSync(join(__dirname, "constants.ts"), "utf8");
    const END = String.fromCharCode(10) + "};";
    const body = src.slice(src.indexOf("export type TenantFeatures = {"));
    const known = new Set(
      [...body.slice(0, body.indexOf(END)).matchAll(/^\s{2}(\w+): boolean;/gm)].map((m) => m[1])
    );
    expect(known.size).toBeGreaterThan(20);
    for (const [object, key] of Object.entries(OBJECT_FEATURE)) {
      if (key === null) continue;
      expect(known, `OBJECT_FEATURE["${object}"] = "${key}" is not a TenantFeatures key`).toContain(key);
    }
  });

  it("covers every queryable list source", () => {
    // /api/v1/ask takes its object from the caller and authorizes it by name,
    // so anything in LIST_SOURCES reaches authorizeApi -- an unmapped one
    // would answer 404 for a tenant that owns the module.
    for (const object of Object.keys(LIST_SOURCES)) {
      const name = object === "project_hours" ? "projects" : object;
      expect(() => featureForObject(name), `LIST_SOURCES."${object}"`).not.toThrow();
    }
  });

  it("throws on an object nobody has decided about", () => {
    expect(() => featureForObject("sales_orders")).toThrow(/No feature mapping/);
  });
});

describe("Data Workbench routes", () => {
  for (const mode of DW_MODES) {
    for (const object of objectDirs(mode)) {
      it(`${mode}/${object} is mapped and gated`, () => {
        expect(() => featureForObject(object)).not.toThrow();
        const src = readFileSync(join(API, mode, object, "route.ts"), "utf8");
        expect(src, `${mode}/${object}/route.ts must call assertObjectFeature`).toContain(
          `assertObjectFeature(tenantId, "${object}")`
        );
      });
    }
  }
});

describe("v1 API routes", () => {
  // authorizeApi() gates centrally, so the check here is that every v1 route
  // actually goes through it -- a route that resolved its tenant some other
  // way would slip the gate.
  const entries = readdirSync(API === "" ? API : join(API, "v1"), { withFileTypes: true })
    .filter((e) => !V1_META.has(e.name));

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    it(`v1/${e.name} authorizes through authorizeApi`, () => {
      const root = join(API, "v1", e.name, "route.ts");
      const files = [root, ...readdirSync(join(API, "v1", e.name), { withFileTypes: true })
        .filter((c) => c.isDirectory())
        .flatMap((c) => [join(API, "v1", e.name, c.name, "route.ts")])]
        .filter(existsSync);
      expect(files.length, `no route files under v1/${e.name}`).toBeGreaterThan(0);
      for (const f of files) {
        expect(readFileSync(f, "utf8"), `${f} must resolve its tenant via authorizeApi`).toContain("authorizeApi(");
      }
    });
  }

  it("every object authorizeApi is called with is mapped", () => {
    const names = new Set<string>();
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "route.ts") {
          for (const m of readFileSync(p, "utf8").matchAll(/authorizeApi\(\s*req\w*\s*,\s*"([^"]+)"/g)) {
            names.add(m[1]);
          }
        }
      }
    };
    walk(join(API, "v1"));
    expect(names.size).toBeGreaterThan(0);
    for (const n of names) expect(() => featureForObject(n), `v1 object "${n}"`).not.toThrow();
  });
});
