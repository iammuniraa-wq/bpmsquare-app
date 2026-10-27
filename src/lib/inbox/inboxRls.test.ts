import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Mail is private correspondence. Like integration_messages and api_keys (audit 2026-10-21), the Inbox tables have row
// level security ON and NO policy at all: a member's own session token (the anon key is public) must not read a team's
// mail, nor write a row claiming a customer said something. The application reaches them only on the service-role
// client, after its module, workcenter and channel-team checks. This replays every migration and fails the build if a
// policy is ever added to one of them.

const ROOT = path.resolve(__dirname, "../../..");
const DIR = path.join(ROOT, "supabase", "migrations");
const TABLES = ["inbox_channels", "inbound_emails", "inbound_email_attachments", "inbox_mailbox_state", "record_files", "record_sources"];

const strip = (sql: string) => sql.replace(/--[^\n]*/g, "");
const all = () => readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => ({ f, sql: strip(readFileSync(path.join(DIR, f), "utf8")) }));

describe("Inbox tables are service-role only", () => {
  it("no migration creates a policy on any of them", () => {
    for (const { f, sql } of all()) {
      for (const t of TABLES) {
        expect(new RegExp(`create\\s+policy[^;]*\\son\\s+(?:public\\.)?"?${t}"?`, "i").test(sql), `${f} creates a policy on ${t}`).toBe(false);
      }
    }
  });

  it("0214 enables row level security on every one of them, in the same file that creates them", () => {
    const sql = strip(readFileSync(path.join(DIR, "0214_inbox.sql"), "utf8"));
    for (const t of TABLES) {
      expect(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+${t}\\b`, "i").test(sql), `${t} created`).toBe(true);
      expect(new RegExp(`alter\\s+table\\s+${t}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql), `${t} RLS`).toBe(true);
      expect(new RegExp(`${t}[\\s\\S]*?tenant_id\\s+uuid\\s+not\\s+null\\s+references\\s+tenants\\(id\\)`, "i").test(sql), `${t} tenant_id`).toBe(true);
    }
  });

  it("the files bucket is private", () => {
    const sql = strip(readFileSync(path.join(DIR, "0214_inbox.sql"), "utf8"));
    expect(sql).toMatch(/insert\s+into\s+storage\.buckets[\s\S]*'inbox-attachments'[\s\S]*,\s*false\b/i);
    expect(sql).not.toMatch(/storage\.objects/i);
  });

  it("the number is the next free one and the migration is idempotent", () => {
    const files = readdirSync(DIR).filter((f) => f.startsWith("0214_"));
    expect(files).toEqual(["0214_inbox.sql"]);
    const sql = strip(readFileSync(path.join(DIR, "0214_inbox.sql"), "utf8"));
    expect(sql).not.toMatch(/create\s+table\s+(?!if\s+not\s+exists)/i);
    expect(sql).not.toMatch(/create\s+(unique\s+)?index\s+(?!if\s+not\s+exists)/i);
  });

  it("email_log gains the 'inbox' kind without dropping a kind another migration added", () => {
    const sql = strip(readFileSync(path.join(DIR, "0214_inbox.sql"), "utf8"));
    expect(sql).toMatch(/pg_get_constraintdef/);
    expect(sql).toMatch(/'inbox'/);
    expect(sql).not.toMatch(/check\s*\(\s*kind\s+in\s*\(/i);
    const ts = readFileSync(path.join(ROOT, "src/lib/emailLog.ts"), "utf8");
    expect(ts).toMatch(/EmailLogKind =[^;]*"inbox"/);
  });

  it("the bundle carries the migration verbatim, and the seed touches demo workspaces only", () => {
    const mig = readFileSync(path.join(DIR, "0214_inbox.sql"), "utf8").replace(/\r\n/g, "\n").trim();
    const bundle = readFileSync(path.join(ROOT, "scripts", "run-bundle-23-inbox-2026-10-24.sql"), "utf8").replace(/\r\n/g, "\n");
    expect(bundle).toContain(mig);
    const seed = strip(readFileSync(path.join(ROOT, "scripts", "seed-inbox-demo.sql"), "utf8"));
    const statements = seed.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThan(5);
    for (const s of statements) expect(s, s.slice(0, 80)).toMatch(/is_demo\s*=\s*true/i);
    expect(seed).toMatch(/\{"inbox": true\}/);
  });
});
