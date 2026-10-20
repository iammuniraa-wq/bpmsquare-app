import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/lib/constants";
import { OBJECT_FEATURE, featureForObject } from "@/lib/objectFeatures";
import { FEATURE_DEPENDENCIES, unmetDependencies } from "@/lib/moduleDependencies";
import { scopeAllows } from "@/app/api/v1/_auth";
import { abmEnabled } from "./server";
import { SEGMENT_FIELDS } from "@/lib/marketingSegmentation";
import { summariseAbm } from "./signals";

// "Vikas and BIM must see nothing": ABM hangs off a platform-admin flag that is off by default.
// These tests fail the build if a route, a menu item or a v1 endpoint slips past it, or if a private
// note or a person's details could reach the API.

const SRC = join(__dirname, "..", "..");
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
};

describe("ABM is behind its own flag", () => {
  it("the menu item needs the abm flag and its own workcenter", () => {
    const leaves = NAV.flatMap((g) => g.items.flatMap((i) => i.children ?? [i]));
    const item = leaves.find((l) => l.href === "/marketing/abm");
    expect(item?.featureKey).toBe("abm");
    expect(item?.workcenterKey).toBe("abm");
  });

  it("is on only when the workspace owns Marketing AND abm", () => {
    expect(abmEnabled({ marketing: true, abm: true })).toBe(true);
    expect(abmEnabled({ marketing: true })).toBe(false);
    expect(abmEnabled({ abm: true })).toBe(false);
    expect(abmEnabled({ marketing: true, abm: false })).toBe(false);
    expect(abmEnabled(null)).toBe(false);
  });

  it("every object spelling a surface uses is owned by the flag, and the flag needs Marketing", () => {
    for (const k of ["abm_programs", "abm_targets", "abm_members", "abm_target_accounts", "abm_buying_group_members", "abm-programs", "abm-targets"]) {
      expect(OBJECT_FEATURE[k], k).toBe("abm");
      expect(featureForObject(k)).toBe("abm");
    }
    expect(FEATURE_DEPENDENCIES.some((d) => d.key === "abm" && d.needs === "marketing" && d.strength === "hard")).toBe(true);
    expect(unmetDependencies({ abm: true }, "abm")).toHaveLength(1);
    expect(unmetDependencies({ abm: true, marketing: true }, "abm")).toHaveLength(0);
  });

  it("every app route resolves the tenant through abmAccess() before doing anything", () => {
    const routes = walk(join(SRC, "app", "api", "abm")).filter((f) => f.endsWith("route.ts"));
    expect(routes.length).toBeGreaterThanOrEqual(9);
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g)?.length ?? 0;
      const gates = src.match(/await abmAccess\(/g)?.length ?? 0;
      expect(gates, f).toBe(handlers);
      expect(src, f).not.toMatch(/tenant_id\s*[:=]\s*(body|json|searchParams|await req)/);
    }
  });

  it("every page gates on the workcenter and both flags", () => {
    const src = readFileSync(join(SRC, "app", "(app)", "marketing", "abm", "pageData.ts"), "utf8");
    expect(src).toContain('requireWorkcenterView("abm")');
    expect(src).toContain('requireFeature("marketing")');
    expect(src).toContain('requireFeature("abm")');
    const pages = walk(join(SRC, "app", "(app)", "marketing", "abm")).filter((f) => f.endsWith("page.tsx"));
    expect(pages.length).toBeGreaterThanOrEqual(5);
    for (const f of pages) expect(readFileSync(f, "utf8"), f).toContain("abmPage()");
  });

  it("the Account 360 card and the dashboard tile are produced only for a workspace with the flag", () => {
    const a360 = readFileSync(join(SRC, "lib", "account360", "server.ts"), "utf8");
    expect(a360).toMatch(/if \(abmOn\) \{/);
    expect(a360).toContain("abmOn = (tenantFeatureRow?.features as TenantFeatures | undefined)?.abm === true");
  });
});

describe("the API never carries a person's private details", () => {
  it("buying-group people are explicit-scope only: a pre-existing * key does not reach them", () => {
    const wildcard = { read: true, write: false, objects: ["*"] };
    expect(scopeAllows(wildcard, "abm_targets", false)).toBe(false);
    expect(scopeAllows({ read: true, write: false, objects: ["abm_targets"] }, "abm_targets", false)).toBe(true);
    // Programs alone carry no personal data and ride the normal scope.
    expect(scopeAllows(wildcard, "abm_programs", false)).toBe(true);
  });

  it("no v1 route, LIST_SOURCES loader or MCP tool selects notes, dropped_reason, progress_reason, emails or phones", () => {
    const files = [
      ...walk(join(SRC, "app", "api", "v1", "abm-programs")),
      ...walk(join(SRC, "app", "api", "v1", "abm-targets")),
    ];
    const list = readFileSync(join(SRC, "lib", "api", "listSources.ts"), "utf8");
    const start = list.indexOf("abm_programs: {");
    const end = list.indexOf("estimates: {", start);
    const abmBlock = list.slice(start, end);
    for (const text of [...files.map((f) => readFileSync(f, "utf8")), abmBlock]) {
      const selects = [...text.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]).join(" ");
      for (const col of ["notes", "dropped_reason", "progress_reason", "email", "phone", "contact_name"]) {
        expect(selects, `${col} selected`).not.toMatch(new RegExp(`\\b${col}\\b`));
      }
      expect(text).not.toContain('select("*")');
    }
    // The buying group on the detail endpoint is id + role only.
    const detail = readFileSync(join(SRC, "app", "api", "v1", "abm-targets", "[id]", "route.ts"), "utf8");
    expect(detail).toContain('.select("id, contact_id, role, is_primary")');
    const mcp = readFileSync(join(SRC, "..", "mcp-server", "mcp.json"), "utf8");
    expect(mcp).toContain('"list_abm_targets"');
    expect(mcp).toContain('"path": "/api/v1/abm-targets/{id}"');
  });

  it("the app GET for a target and its members leaves the private note out", () => {
    const t = readFileSync(join(SRC, "app", "api", "abm", "targets", "[id]", "route.ts"), "utf8");
    expect(t).toContain("notes: _n");
    const m = readFileSync(join(SRC, "app", "api", "abm", "targets", "[id]", "members", "route.ts"), "utf8");
    expect(m).toContain('select("id, target_account_id, contact_id, role, is_primary, owner_user_id, added_via, created_at")');
    const exp = readFileSync(join(SRC, "app", "api", "export", "abm_members", "route.ts"), "utf8");
    // The export reads people by id, role and custom data only; the note column is never named in a select.
    expect(exp).toContain('"id, target_account_id, contact_id, role, custom_data"');
  });
});

describe("segment fields", () => {
  it("offers the three ABM fields", () => {
    for (const k of ["in_abm_program", "abm_progress", "abm_tier"]) expect(SEGMENT_FIELDS.some((f) => f.key === k), k).toBe(true);
  });

  it("summarises only active programs and ignores dropped companies", () => {
    const rows = [
      { progress: "engaged" as const, tier: "one_to_many" as const, program: { ref: "ABM-0001", name: "Riyadh developers 2027", status: "active" } },
      { progress: "won" as const, tier: "one_to_one" as const, program: { ref: "ABM-0002", name: "Repeat", status: "paused" } },
      { progress: "dropped" as const, tier: "one_to_one" as const, program: { ref: "ABM-0003", name: "Old", status: "active" } },
    ];
    expect(summariseAbm(rows)).toEqual({ in_abm_program: "ABM-0001 Riyadh developers 2027", abm_progress: "engaged", abm_tier: "one_to_many" });
    expect(summariseAbm([])).toEqual({ in_abm_program: "", abm_progress: "", abm_tier: "" });
  });
});
