import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { SETTINGS_MENU } from "@/lib/settingsMenu";
import { ROUTES } from "@/lib/constants";

// GCC tender deals, slice 1b: the shape of migration 0221, the bundle that carries it, the ledger, and the rules of the new
// routes that a behaviour test cannot see (where the caller's identity comes from, how mail leaves).

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0221_tender_approval_and_bond.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("migration 0221", () => {
  it("is idempotent", () => {
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
    for (const m of code.matchAll(/add column (if not exists )?(\w+)/gi)) expect(m[1], `add column ${m[2]}`).toBeTruthy();
  });

  it("approval_requests has RLS, a tenant SELECT policy and nothing that writes (0199: a member must not forge an approval)", () => {
    expect(code).toMatch(/alter table approval_requests enable row level security/);
    const policies = [...code.matchAll(/create policy "([^"]+)" on approval_requests for (\w+)/gi)];
    expect(policies).toHaveLength(1);
    expect(policies[0][2].toLowerCase()).toBe("select");
    expect(code).toMatch(/on approval_requests for select using \(tenant_id in \(select tenant_id from tenant_users where user_id = auth\.uid\(\)\)\)/);
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("carries tenant_id, the four statuses, and allows ONE pending proposal per record and kind", () => {
    expect(code).toMatch(/create table if not exists approval_requests \( id uuid primary key default gen_random_uuid\(\), tenant_id uuid not null references tenants\(id\)/);
    expect(code).toMatch(/status in \('pending', 'approved', 'rejected', 'cancelled'\)/);
    expect(code).toMatch(/create unique index if not exists approval_requests_one_pending on approval_requests \(tenant_id, object_type, object_id, kind\) where status = 'pending'/);
    for (const col of ["object_type", "object_id", "kind", "proposed_value", "reason", "requested_by", "decided_by", "decided_at", "decision_comment", "created_at"]) {
      expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it("adds the bond's life to opportunity_tenders and touches no column of opportunities", () => {
    expect(code).toMatch(/alter table if exists opportunity_tenders add column if not exists bond_status text not null default 'held' check \(bond_status in \('held', 'released'\)\)/);
    expect(code).toMatch(/add column if not exists bond_released_at timestamptz/);
    expect(code).toMatch(/add column if not exists bond_released_by uuid/);
    expect(code).not.toMatch(/alter table (if exists )?"?(public"?\.)?opportunities\b/i);
  });

  it("the bundle carries it verbatim, and the ledger lists it as pending", () => {
    const bundle = lf(read("scripts/run-bundle-32-tender-approval-and-room-2026-10-25.sql"));
    expect(bundle).toContain(sql.trim());
    expect(existsSync(path.join(ROOT, "scripts/run-bundle-32-tender-approval-and-room-2026-10-25.sql"))).toBe(true);
    const project = read("PROJECT.md");
    expect(project).toMatch(/0221_tender_approval_and_bond\.sql/);
    expect(project).toMatch(/run-bundle-32-tender-approval-and-room-2026-10-25\.sql/);
  });
});

describe("the approval routes", () => {
  const routes = [
    "src/app/api/opportunities/[id]/tender/approval/route.ts",
    "src/app/api/opportunities/[id]/tender/approval/[requestId]/route.ts",
    "src/app/api/opportunities/[id]/tender/bond/route.ts",
  ];

  it("resolve the caller and the workspace from the session, never from the body", () => {
    for (const f of routes) {
      const src = read(f);
      expect(src, f).toMatch(/requireTenantUser\(\)/);
      expect(src, f).toMatch(/gcc_tender/);
      expect(src, f).not.toMatch(/body\.(tenant_id|requested_by|decided_by|decided_at|bond_released_by)/);
    }
  });

  it("every approval query is tenant-scoped", () => {
    const server = read("src/lib/tender/approvalServer.ts");
    for (const m of server.matchAll(/from\("approval_requests"\)[^;]*;/g)) expect(m[0], m[0].slice(0, 80)).toMatch(/\.eq\("tenant_id", tenantId\)/);
    const decide = read("src/app/api/opportunities/[id]/tender/approval/[requestId]/route.ts");
    for (const m of decide.matchAll(/from\("approval_requests"\)[\s\S]*?;\n/g)) expect(m[0], m[0].slice(0, 80)).toMatch(/\.eq\("tenant_id", tenantId\)/);
  });

  it("mail leaves through resolveOutbound and the email log; the inbox entry is a mentioning comment", () => {
    const notify = read("src/lib/tender/notify.ts");
    expect(notify).toMatch(/resolveOutbound\(/);
    expect(notify).toMatch(/logEmail\(/);
    expect(notify).toMatch(/from\("record_comments"\)\.insert/);
    for (const f of routes.slice(0, 2)) expect(read(f), f).toMatch(/sendTenderMail\(/);
  });

  it("the stage guard sits in the opportunity PATCH, behind the tender row (a standard deal is never asked)", () => {
    const src = lf(read("src/app/api/opportunities/[id]/route.ts"));
    expect(src).toMatch(/if \(tender !== null && stage !== before\.stage\) \{\s*const standing = await standingDecision/);
    expect(src).toMatch(/stageGuard\(/);
  });

  it("the slice-1 decision route is gone: nothing can record a decision without approval", () => {
    expect(existsSync(path.join(ROOT, "src/app/api/opportunities/[id]/tender/decision/route.ts"))).toBe(false);
  });
});

describe("Settings > Tenders", () => {
  it("is one admin-only entry in Sales, behind the flag, and the route is admin-only", () => {
    const entry = SETTINGS_MENU.find((m) => m.id === "tenders")!;
    expect(entry).toMatchObject({ group: "sales", adminOnly: true, featureKey: "gcc_tender", href: ROUTES.settingsTenders });
    expect(SETTINGS_MENU.filter((m) => /tender/i.test(m.label))).toHaveLength(1);
    expect(read("src/app/api/settings/tender/route.ts")).toMatch(/role !== "admin"/);
    expect(read("src/app/(app)/settings/tenders/page.tsx")).toMatch(/role !== "admin"/);
  });

  it("the approval table belongs to the tender module for every surface that asks", () => {
    expect(featureForObject("approval_requests")).toBe("gcc_tender");
  });
});
