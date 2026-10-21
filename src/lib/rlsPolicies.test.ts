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

  it("0202 (webhooks library) adds no policy to webhooks, and its bundle carries the migration verbatim", () => {
    // The library puts header values and a signing secret on `webhooks`: a member must still not be able to write them.
    const file = readFileSync(path.join(DIR, "0202_webhooks_library.sql"), "utf8");
    expect(/create\s+policy/i.test(file.replace(/--[^\n]*/g, ""))).toBe(false);
    expect([...(policies.get("webhooks")?.values() ?? [])]).toEqual([]);
    const bundle = readFileSync(path.resolve(__dirname, "../../scripts/run-bundle-11-webhooks-2026-10-21.sql"), "utf8");
    expect(bundle.replace(/\r\n/g, "\n")).toContain(file.replace(/\r\n/g, "\n").trim());
  });

  it("the policy replay understands the migrations it is judging", () => {
    // 0081 created the open policy and 0199 dropped it: the replay must see both.
    expect(policies.get("webhook_deliveries")?.size).toBeGreaterThan(0);
    expect(policies.get("tenants")?.size).toBeGreaterThan(0);
  });
});
