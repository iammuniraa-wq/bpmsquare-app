import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { OBJECT_FEATURE, featureForObject } from "@/lib/objectFeatures";
import { MODULE_LABEL } from "@/lib/capability/generate";
import { FEATURE_DEPENDENCIES, FEATURE_GROUP } from "@/lib/moduleDependencies";
import { EXPERIMENTAL_FEATURE_KEYS } from "@/lib/admin/tenantStudio";
import { DEFERRED } from "@/lib/actions/registry";
import { scopeForChangeType } from "@/lib/api/changeFeedScope";

// GCC tender deals, slice 1: the wiring of bpmsquarecore 3b that applies, the migration's shape, and the hard rule that the
// standard files do not know the edition exists.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0220_tender_deals.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("the flags", () => {
  it("gcc_tender and deal_room are platform-admin modules, default off, in the editor and the new-tenant form", () => {
    expect(read("src/lib/constants.ts")).toMatch(/gcc_tender: boolean;/);
    expect(read("src/lib/constants.ts")).toMatch(/deal_room: boolean;/);
    const editor = read("src/app/admin/tenants/[id]/TenantEditor.tsx");
    expect(editor).toMatch(/key: "gcc_tender"/);
    expect(editor).toMatch(/key: "deal_room"/);
    const form = read("src/app/admin/tenants/new/NewTenantForm.tsx");
    expect(form).toMatch(/gcc_tender: false/);
    expect(form).toMatch(/deal_room: false/);
    expect(EXPERIMENTAL_FEATURE_KEYS).toEqual(expect.arrayContaining(["gcc_tender", "deal_room"]));
    expect(MODULE_LABEL.gcc_tender).toBe("GCC tender deals");
    expect(MODULE_LABEL.deal_room).toBe("Deal Room");
    expect(FEATURE_GROUP.gcc_tender).toBe("sales");
  });

  it("the Deal Room is declared but nothing reads it yet", () => {
    for (const f of ["src/lib/tender/server.ts", "src/lib/tender/rules.ts", "src/app/api/opportunities/tender/route.ts", "src/app/(app)/pipeline/page.tsx"]) {
      expect(read(f), f).not.toMatch(/deal_room/);
    }
  });

  it("the tender edition needs the Pipeline, and the room needs the edition", () => {
    expect(FEATURE_DEPENDENCIES).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "gcc_tender", needs: "pipeline", strength: "hard" }),
      expect.objectContaining({ key: "deal_room", needs: "gcc_tender", strength: "hard" }),
    ]));
  });
});

describe("3b surfaces that apply", () => {
  it("OBJECT_FEATURE says which module owns the tender, under every name a surface uses", () => {
    for (const k of ["opportunity_tender", "opportunity_tenders", "deal_types", "tenders"]) expect(featureForObject(k), k).toBe("gcc_tender");
    expect(OBJECT_FEATURE.opportunities).toBe("pipeline");
  });

  it("change history lists the tender block, behind the flag", () => {
    const src = read("src/app/(app)/administration/change-history/ChangeHistoryClient.tsx");
    expect(src).toMatch(/value: "opportunity_tenders"/);
    expect(src).toMatch(/useTenantFeature\("gcc_tender"\)/);
  });

  it("Talk to data has a tenders source that leaves the internal columns out", () => {
    const src = read("src/lib/api/listSources.ts");
    const start = src.indexOf("  tenders: {");
    const block = src.slice(start, src.indexOf("  rfqs: {", start));
    expect(block).toMatch(/relatedWorkcenter: "pipeline"/);
    const selects = [...block.matchAll(/\.select\(\s*"([^"]+)"/g)].map((m) => m[1]).join(" ");
    for (const internal of ["decision_reason", "decided_by", "source_email_id", "custom_data", "reminders_sent", "tenant_id"]) expect(selects, internal).not.toContain(internal);
    expect(selects).toContain("tender_no");
    expect(block.match(/\.eq\("tenant_id", tenantId\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the tender scope is explicit-only, so no existing '*' key widens; the change feed follows it", () => {
    expect(read("src/app/api/v1/_auth.ts")).toMatch(/EXPLICIT_SCOPE_ONLY = new Set\([^)]*"tenders"/);
    expect(scopeForChangeType("opportunity_tenders")).toBe("tenders");
    expect(read("src/app/api/settings/api-keys/route.ts")).toMatch(/"tenders"\]/);
  });

  it("the assistant's create card is deferred with a stated reason", () => {
    expect(DEFERRED.opportunities).toMatch(/tender/i);
    expect(DEFERRED.opportunities.length).toBeGreaterThan(40);
  });

  it("the command palette offers New Tender, behind the flag", () => {
    expect(read("src/lib/createActions.ts")).toMatch(/label: "New Tender",\s+href: "\/pipeline\/new\/tender", featureKey: "gcc_tender"/);
  });

  it("global search finds a tender as the Deal it is (no second search object)", () => {
    expect(read("src/lib/globalSearch.ts")).toMatch(/type: "opportunity", label: "Deals"/);
  });
});

describe("the cron job", () => {
  it("is authorised by the cron secret, public to the session gate, and scheduled daily", () => {
    expect(read("src/app/api/tenders/cron/reminders/route.ts")).toMatch(/cronSecretOk\(/);
    expect(read("src/proxy.ts")).toMatch(/startsWith\("\/api\/tenders\/cron\/"\)/);
    const vercel = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const entry = vercel.crons.find((c) => c.path === "/api/tenders/cron/reminders");
    expect(entry).toBeTruthy();
    expect(entry?.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
  });

  it("every reminder goes through resolveOutbound and the email log", () => {
    const src = read("src/lib/tender/reminders.ts");
    expect(src).toMatch(/resolveOutbound\(/);
    expect(src).toMatch(/logEmail\(/);
    expect(read("src/lib/emailLog.ts")).toMatch(/"tender"/);
  });
});

describe("the standard flow does not know the edition exists", () => {
  it.each([
    "src/app/api/opportunities/route.ts",
    "src/app/(app)/pipeline/new/NewOpportunityForm.tsx",
    "src/app/(app)/pipeline/new/page.tsx",
    "src/lib/sales/opportunity.ts",
  ])("%s mentions no tender", (f) => {
    expect(read(f)).not.toMatch(/tender/i);
  });

  it("no column is added to opportunities", () => {
    expect(code).not.toMatch(/alter table opportunities/i);
    expect(code).not.toMatch(/alter table "?public"?\.opportunities/i);
  });

  it("the tender routes never read the tenant from the request", () => {
    for (const f of ["src/app/api/opportunities/tender/route.ts", "src/app/api/opportunities/[id]/tender/route.ts", "src/app/api/opportunities/[id]/tender/approval/route.ts", "src/app/api/opportunities/[id]/tender/approval/[requestId]/route.ts", "src/app/api/opportunities/[id]/tender/bond/route.ts"]) {
      const src = read(f);
      expect(src, f).toMatch(/requireTenantUser\(\)/);
      expect(src, f).not.toMatch(/body\.tenant_id|searchParams\.get\("tenant/);
      expect(src, f).not.toMatch(/body\.decided_by|body\.decided_at/);
    }
  });
});

describe("migration 0220", () => {
  it("is idempotent", () => {
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
  });

  it("both tables have RLS and a tenant SELECT policy and nothing that writes", () => {
    for (const table of ["deal_types", "opportunity_tenders"]) {
      expect(code, table).toMatch(new RegExp(`alter table ${table} enable row level security`));
      const policies = [...code.matchAll(new RegExp(`create policy "([^"]+)" on ${table} for (\\w+)`, "gi"))];
      expect(policies, table).toHaveLength(1);
      expect(policies[0][2].toLowerCase()).toBe("select");
      expect(code, table).toMatch(new RegExp(`on ${table} for select using \\(tenant_id in \\(select tenant_id from tenant_users where user_id = auth\\.uid\\(\\)\\)\\)`));
    }
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("both tables carry tenant_id, and a tender is keyed one-to-one on its deal", () => {
    expect(code).toMatch(/create table if not exists deal_types \([^;]*tenant_id uuid not null references tenants\(id\)/);
    expect(code).toMatch(/create table if not exists opportunity_tenders \( opportunity_id uuid primary key references opportunities\(id\) on delete cascade, tenant_id uuid not null references tenants\(id\)/);
    expect(code).toMatch(/unique index if not exists opportunity_tenders_tender_no_uniq on opportunity_tenders \(tenant_id, tender_no\) where tender_no is not null/);
  });

  it("has the columns the code reads", () => {
    for (const col of ["tender_no", "issuer_name", "issuer_account_id", "portal", "closing_at", "bid_bond_amount", "bid_bond_currency", "bid_bond_expiry", "addenda_count", "decision", "decision_reason", "decided_by", "decided_at", "source_email_id", "custom_data", "reminders_sent", "deal_type_id"]) {
      expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    }
    expect(code).toMatch(/portal text check \(portal in \('ariba', 'email', 'excel', 'other'\)\)/);
    expect(code).toMatch(/decision text check \(decision in \('go', 'no_go'\)\)/);
  });

  it("widens the Inbox lists by deal / opportunities, each guarded by the table existing, and email_log by tender", () => {
    expect(code).toMatch(/to_regclass\('public\.' \|\| spec\.tbl\) is null/);
    for (const [tbl, col] of [["inbox_channels", "default_action"], ["inbound_emails", "linked_object_type"], ["record_files", "object_type"], ["record_sources", "object_type"]]) {
      expect(code, `${tbl}.${col}`).toContain(`'${tbl}',`);
      expect(code, `${tbl}.${col}`).toContain(`'${col}',`);
    }
    // The values the application writes: every Inbox create type and link type is in the widened lists.
    for (const v of ["'quote'", "'project'", "'case'", "'estimate'", "'lead'", "'deal'", "'none'", "'standard_quotes'", "'wfm_projects'", "'cases'", "'estimates'", "'leads'", "'opportunities'"]) expect(code, v).toContain(v);
    expect(code).toMatch(/to_regclass\('public\.email_log'\)/);
    expect(code).toContain("'tender'");
  });

  it("the Inbox lists in the code and in the migration agree", async () => {
    const { CREATE_TYPES, LINK_OBJECT_TYPES } = await import("@/lib/inbox/types");
    for (const t of [...CREATE_TYPES, "none"]) expect(sql, t).toContain(`''${t}''`);
    for (const t of LINK_OBJECT_TYPES) expect(sql, t).toContain(`''${t}''`);
  });

  it("the bundle carries the migration verbatim", () => {
    const bundle = lf(read("scripts/run-bundle-31-tender-deals-2026-10-25.sql"));
    expect(bundle).toContain(sql.trim());
    expect(existsSync(path.join(ROOT, "scripts/run-bundle-31-tender-deals-2026-10-25.sql"))).toBe(true);
  });

  it("is listed as pending in the operational ledger", () => {
    const project = read("PROJECT.md");
    expect(project).toMatch(/0220_tender_deals\.sql/);
    expect(project).toMatch(/run-bundle-31-tender-deals-2026-10-25\.sql/);
  });
});
