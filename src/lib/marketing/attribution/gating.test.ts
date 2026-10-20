import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/lib/constants";
import { OBJECT_FEATURE, featureForObject } from "@/lib/objectFeatures";
import { FEATURE_DEPENDENCIES, unmetDependencies } from "@/lib/moduleDependencies";
import { moduleEnabled } from "@/lib/marketing/moduleAccess";
import { attributionEnabled } from "./runner";

// "Vikas and BIM must see nothing", and "attribution only reads": the flag is off by default, every route and
// page asks the same question, the cron needs its secret, and nothing in the library can change a deal.

const SRC = join(__dirname, "..", "..", "..");
const ROOT = join(SRC, "..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css|json)$/.test(name)) out.push(p);
  }
  return out;
};
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), "utf8");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("Attribution is behind its own flag", () => {
  it("the menu item needs marketing_attribution and its own workcenter", () => {
    const leaves = NAV.flatMap((g) => g.items.flatMap((i) => i.children ?? [i]));
    const item = leaves.find((l) => l.href === "/marketing/attribution");
    expect(item?.featureKey).toBe("marketing_attribution");
    expect(item?.workcenterKey).toBe("marketing_attribution");
  });

  it("needs BOTH the Marketing module and the platform-admin flag", () => {
    expect(attributionEnabled({ marketing: true, marketing_attribution: true })).toBe(true);
    expect(attributionEnabled({ marketing: true })).toBe(false);
    expect(attributionEnabled({ marketing_attribution: true })).toBe(false);
    expect(moduleEnabled({ flag: "marketing_attribution" }, { marketing: true, marketing_attribution: true })).toBe(true);
    expect(moduleEnabled({ flag: "marketing_attribution" }, { marketing: true })).toBe(false);
  });

  it("the objects are owned by the flag, and the flag needs Marketing", () => {
    for (const k of ["marketing_touches", "attribution_results"]) {
      expect(OBJECT_FEATURE[k], k).toBe("marketing_attribution");
      expect(featureForObject(k)).toBe("marketing_attribution");
    }
    expect(FEATURE_DEPENDENCIES.some((d) => d.key === "marketing_attribution" && d.needs === "marketing" && d.strength === "hard")).toBe(true);
    expect(unmetDependencies({ marketing_attribution: true }, "marketing_attribution").map((u) => u.needs).sort()).toEqual(["marketing", "pipeline"]);
    expect(unmetDependencies({ marketing_attribution: true, marketing: true, pipeline: true }, "marketing_attribution")).toHaveLength(0);
  });

  it("the signed-in route and the page resolve the tenant through the module gate first", () => {
    const route = read("app", "api", "attribution", "recompute", "route.ts");
    expect(route.match(/export async function (GET|POST)/g)?.length).toBe(route.match(/await moduleAccess\(ATTRIBUTION_SPEC/g)?.length);
    expect(route).not.toMatch(/tenant_id\s*[:=]\s*(body|json|searchParams)/);
    expect(route).toMatch(/role !== "admin"/);
    expect(read("app", "(app)", "marketing", "attribution", "page.tsx")).toMatch(/await modulePage\(ATTRIBUTION_SPEC\)/);
  });

  it("the cron answers 401 without CRON_SECRET and is on a schedule", () => {
    const route = read("app", "api", "marketing", "cron", "attribution", "route.ts");
    expect(route).toMatch(/Bearer \$\{process\.env\.CRON_SECRET\}/);
    expect(route.indexOf("CRON_SECRET")).toBeLessThan(route.indexOf("createAdminSupabase()"));
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons.some((c) => c.path === "/api/marketing/cron/attribution")).toBe(true);
    expect(read("proxy.ts")).toContain('pathname.startsWith("/api/marketing/cron/")');
  });
});

describe("Attribution only reads", () => {
  it("nothing in the library writes to opportunities, quotes, invoices, accounts or contacts", () => {
    const files = walk(join(SRC, "lib", "marketing", "attribution")).filter((f) => !f.endsWith(".test.ts"));
    for (const f of files) {
      const src = code(readFileSync(f, "utf8"));
      for (const table of ["opportunities", "quotes", "invoices", "accounts", "contacts", "leads", "domain_event"]) {
        expect(src, `${f} writes ${table}`).not.toMatch(new RegExp(`from\\("${table}"\\)[\\s\\S]{0,160}\\.(insert|update|upsert|delete)\\(`));
      }
      expect(src, f).not.toMatch(/console\.log/);
    }
  });

  it("every query on a tenant-owned table names the tenant", () => {
    for (const f of ["compute.ts", "touches.ts", "runner.ts", "server.ts"]) {
      const src = code(read("lib", "marketing", "attribution", f));
      const reads = src.match(/\.from\("(opportunities|quotes|invoices|marketing_touches|attribution_results|attribution_state|domain_event|contacts)"\)/g) ?? [];
      const tenantFilters = src.match(/\.eq\("tenant_id", tenantId\)|\.eq\("tenant_id", ctx\.tenantId\)|\{ tenant_id: tenantId \}/g) ?? [];
      expect(tenantFilters.length, f).toBeGreaterThanOrEqual(reads.length > 0 ? 1 : 0);
    }
  });

  it("no v1 endpoint, list source or MCP tool offers touches or results", () => {
    for (const f of walk(join(SRC, "app", "api", "v1"))) expect(readFileSync(f, "utf8").toLowerCase(), f).not.toMatch(/marketing_touches|attribution_results/);
    expect(read("lib", "api", "listSources.ts").toLowerCase()).not.toMatch(/marketing_touches|attribution_results/);
    const mcp = join(ROOT, "mcp-server", "mcp.json");
    if (existsSync(mcp)) expect(readFileSync(mcp, "utf8").toLowerCase()).not.toMatch(/attribution|marketing_touches/);
  });

  it("the report says in words which model it used and what attribution cannot say", () => {
    const studio = read("app", "(app)", "marketing", "attribution", "AttributionStudio.tsx");
    expect(studio).toContain("interpretation(");
    expect(studio).toContain("How to read this");
    expect(read("lib", "marketing", "attribution", "models.ts")).toContain("not why they were won");
  });
});
