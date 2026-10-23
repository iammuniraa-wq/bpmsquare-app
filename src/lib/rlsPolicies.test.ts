import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Security audit 2026-10-21. A table that holds or steers a credential must not
// be writable by an ordinary member of the workspace through PostgREST: the anon
// key is public and a member's session token is readable by their own browser,
// so a `for all` tenant-isolation policy is a write path no admin check in an
// API route can close. This replays every migration in order and asserts the
// policies that are actually left on the three tables the audit found open.

type Policy = { name: string; cmd: "all" | "select" | "insert" | "update" | "delete"; text: string };

const DIR = path.resolve(__dirname, "../../supabase/migrations");

function effectivePolicies(): Map<string, Map<string, Policy>> {
  const out = new Map<string, Map<string, Policy>>();
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(path.join(DIR, f), "utf8").replace(/--[^\n]*/g, "");
    for (const stmt of sql.split(";")) {
      // A guarded migration wraps its statements in execute '…' / execute $p$…$p$
      // inside a DO block (0199): unwrap them so the replay still sees the policy.
      const s = stmt.replace(/\s+/g, " ").trim().replace(/^execute\s+(?:'|\$\w*\$)\s*/i, "").replace(/\s*(?:'|\$\w*\$)$/, "");
      let m = /^drop policy (?:if exists )?"([^"]+)" on (?:public\.)?"?(\w+)"?/i.exec(s);
      if (m) { out.get(m[2])?.delete(m[1]); continue; }
      m = /^create policy "([^"]+)" on (?:public\.)?"?(\w+)"?\s*(?:as \w+ )?(?:for (all|select|insert|update|delete))?/i.exec(s);
      if (m) {
        const table = m[2];
        if (!out.has(table)) out.set(table, new Map());
        out.get(table)!.set(m[1], { name: m[1], cmd: (m[3]?.toLowerCase() ?? "all") as Policy["cmd"], text: s });
      }
    }
  }
  return out;
}

const writes = (p: Policy) => p.cmd !== "select";
const adminOnly = (p: Policy) => /role\s*=\s*'admin'/.test(p.text);

describe("credential tables are not member-writable (audit 2026-10-21)", () => {
  const policies = effectivePolicies();

  it("api_keys has no policy at all: only the service role reaches it", () => {
    expect([...(policies.get("api_keys")?.values() ?? [])].map((p) => p.name)).toEqual([]);
  });

  it("webhooks has no policy at all: only the service role reaches it", () => {
    expect([...(policies.get("webhooks")?.values() ?? [])].map((p) => p.name)).toEqual([]);
  });

  it("integration_messages has no policy at all: the app reads and writes it only through the service role", () => {
    expect([...(policies.get("integration_messages")?.values() ?? [])].map((p) => p.name)).toEqual([]);
  });

  it("tenant_connectors: every write policy is admin-only, members may only read", () => {
    const list = [...(policies.get("tenant_connectors")?.values() ?? [])];
    expect(list.length).toBeGreaterThan(0);
    for (const p of list.filter(writes)) expect(adminOnly(p), `${p.name} must require role = 'admin'`).toBe(true);
    expect(list.some((p) => p.cmd === "all")).toBe(false);
    expect(list.some((p) => p.cmd === "select")).toBe(true);
  });

  it.each(["business_roles", "business_role_grants", "business_user_roles"])(
    "%s (audit 2026-10-22 M2): every write policy is admin-only, members may only read", (table) => {
      const list = [...(policies.get(table)?.values() ?? [])];
      expect(list.length).toBeGreaterThan(0);
      for (const p of list.filter(writes)) expect(adminOnly(p), `${p.name} must require role = 'admin'`).toBe(true);
      expect(list.some((p) => p.cmd === "all")).toBe(false);
      expect(list.some((p) => p.cmd === "select")).toBe(true);
      expect(list.map((p) => p.cmd).sort()).toEqual(["delete", "insert", "select", "update"]);
    },
  );

  it("no route writes the Business Role tables with the member's session client", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || /\.test\./.test(e.name)) continue;
        const src = readFileSync(p, "utf8");
        const re = /\bsupabase\s*\.from\(\s*"(business_roles|business_role_grants|business_user_roles)"\s*\)\s*\.(insert|update|delete|upsert)\(/g;
        if (re.test(src)) offenders.push(path.relative(path.resolve(__dirname, "../.."), p));
      }
    };
    walk(path.resolve(__dirname, ".."));
    expect(offenders).toEqual([]);
  }, 30_000);

  it("0207's bundle carries the migration verbatim", () => {
    const file = readFileSync(path.join(DIR, "0207_business_roles_rls.sql"), "utf8");
    const bundle = readFileSync(path.resolve(__dirname, "../../scripts/run-bundle-16-security-2026-10-22.sql"), "utf8");
    expect(bundle.replace(/\r\n/g, "\n")).toContain(file.replace(/\r\n/g, "\n").trim());
  });

  it("change_log (audit 2026-10-22 AI, M1): members may only read; the only writer is changeLog.ts", () => {
    const list = [...(policies.get("change_log")?.values() ?? [])];
    expect(list.filter(writes).map((p) => p.name)).toEqual([]);
    expect(list.some((p) => p.cmd === "select")).toBe(true);

    const offenders: string[] = [];
    const root = path.resolve(__dirname, "../..");
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(e.name) || /\.test\./.test(e.name) || e.name === "changeLog.ts") continue;
        if (/\.from\(\s*["'`]change_log["'`]\s*\)\s*\.(insert|update|delete|upsert)\(/.test(readFileSync(p, "utf8"))) offenders.push(path.relative(root, p));
      }
    };
    walk(path.resolve(__dirname, ".."));
    expect(offenders).toEqual([]);

    const file = readFileSync(path.join(DIR, "0208_change_log_member_insert.sql"), "utf8");
    expect(file).toMatch(/to_regclass\('public\.change_log'\)/);
    const bundle = readFileSync(path.resolve(__dirname, "../../scripts/run-bundle-17-changelog-2026-10-22.sql"), "utf8");
    expect(bundle.replace(/\r\n/g, "\n")).toContain(file.replace(/\r\n/g, "\n").trim());
  }, 30_000);

  it("record_comments (audit 2026-10-21 L1): members may only read; the only writer is the comments route, with the service role", () => {
    const list = [...(policies.get("record_comments")?.values() ?? [])];
    expect(list.filter(writes).map((p) => p.name)).toEqual([]);
    expect(list.some((p) => p.cmd === "select")).toBe(true);

    const root = path.resolve(__dirname, "../..");
    const route = readFileSync(path.join(root, "src/app/api/nova/comments/route.ts"), "utf8");
    expect(route).toMatch(/createAdminSupabase\(\)\.from\("record_comments"\)\.insert\(/);
    expect(route).not.toMatch(/\bsupabase\s*\.from\("record_comments"\)\s*\.insert\(/);

    const file = readFileSync(path.join(DIR, "0211_record_comments_member_insert.sql"), "utf8");
    expect(file).toMatch(/to_regclass\('public\.record_comments'\)/);
    const bundle = readFileSync(path.join(root, "scripts/run-bundle-20-record-comments-2026-10-23.sql"), "utf8");
    expect(bundle.replace(/\r\n/g, "\n")).toContain(file.replace(/\r\n/g, "\n").trim());
  });

  it("0202 (webhooks library) adds no policy to webhooks, and its bundle carries the migration verbatim", () => {
    // The library puts header values and a signing secret on `webhooks`: a member must still not be able to write them.
    const file = readFileSync(path.join(DIR, "0202_webhooks_library.sql"), "utf8");
    expect(/create\s+policy/i.test(file.replace(/--[^\n]*/g, ""))).toBe(false);
    expect([...(policies.get("webhooks")?.values() ?? [])]).toEqual([]);
    const bundle = readFileSync(path.resolve(__dirname, "../../scripts/run-bundle-11-webhooks-2026-10-21.sql"), "utf8");
    expect(bundle.replace(/\r\n/g, "\n")).toContain(file.replace(/\r\n/g, "\n").trim());
  });

  it("0203 (mapping engine): integration_mappings and integration_value_lists have no policy at all, and the file adds none", () => {
    // A mapping steers what the server sends to a third party: a member must never write one with their own session.
    expect([...(policies.get("integration_mappings")?.values() ?? [])]).toEqual([]);
    expect([...(policies.get("integration_value_lists")?.values() ?? [])]).toEqual([]);
    const file = readFileSync(path.join(DIR, "0203_mapping_engine.sql"), "utf8");
    expect(/create\s+policy/i.test(file.replace(/--[^\n]*/g, ""))).toBe(false);
    expect(file).toMatch(/alter table integration_mappings enable row level security/);
    expect(file).toMatch(/alter table integration_value_lists enable row level security/);
    const bundle = readFileSync(path.resolve(__dirname, "../../scripts/run-bundle-12-mapping-2026-10-21.sql"), "utf8");
    expect(bundle.replace(/\r\n/g, "\n")).toContain(file.replace(/\r\n/g, "\n").trim());
  });

  it("the policy replay understands the migrations it is judging", () => {
    // 0081 created the open policy and 0199 dropped it: the replay must see both.
    expect(policies.get("webhook_deliveries")?.size).toBeGreaterThan(0);
    expect(policies.get("tenants")?.size).toBeGreaterThan(0);
  });
});
