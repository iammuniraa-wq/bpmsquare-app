import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { fakeDb } from "@/lib/marketing/testFakeDb";

// The routes and the migration around revision history: no member write path, the tenant only ever from the session, the lock on
// the edit route, the PDF of any revision, copy to a new quotation, and "switch off = nothing changes".

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

describe("migration 0252", () => {
  const sql = read("supabase/migrations/0252_document_revisions.sql");
  it("gives members a SELECT policy and nothing that writes, and refuses an update", () => {
    expect(sql).toMatch(/enable row level security/);
    const policies = [...sql.matchAll(/create policy[^;]*;/g)].map((m) => m[0]);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/for select/);
    expect(policies[0]).not.toMatch(/for (all|insert|update|delete)/);
    expect(sql).toMatch(/before update on document_revisions/);
    expect(sql).toMatch(/raise exception/);
  });
  it("is keyed so two issues of one revision cannot both land, and demands a reason from revision 1", () => {
    expect(sql).toMatch(/unique \(tenant_id, object_type, object_id, revision_no\)/);
    expect(sql).toMatch(/check \(revision_no = 0 or reason is not null\)/);
    expect(sql).toMatch(/tenant_id\s+uuid not null references tenants\(id\)/);
  });
  it("is idempotent and has a hand-apply bundle", () => {
    expect(sql).toMatch(/create table if not exists document_revisions/);
    expect(sql.match(/add column if not exists/g)).toHaveLength(3);
    const bundle = read("scripts/run-bundle-54-pdf-slice2-revisions-2026-11-23.sql");
    expect(bundle).toContain("create table if not exists document_revisions");
    expect(bundle).toMatch(/^begin;$/m);
    expect(bundle).toMatch(/^commit;$/m);
  });
});

describe("routes", () => {
  const routes = ["issue", "revise", "copy"].map((r) => ({ r, src: read(`src/app/api/standard-quotes/[id]/${r}/route.ts`) }));
  it("take the tenant from the session, never from the request", () => {
    for (const { r, src } of routes) {
      expect(src, r).toMatch(/requireTenantUser\(\)/);
      expect(src, r).not.toMatch(/body\.tenant|searchParams\.get\("tenant|body\.issued_by|body\.actor/);
    }
  });
  it("the only writer of document_revisions is the revisions module", () => {
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(p); }
        else if (/\.tsx?$/.test(e.name) && !/\.test\.ts$/.test(e.name) && /from\("document_revisions"\)\s*\.(insert|update|upsert|delete)/.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(ROOT, p).replace(/\\/g, "/"));
      }
    };
    walk(path.join(ROOT, "src"));
    expect(hits).toEqual(["src/lib/revisions/server.ts"]);
  }, 60_000);
  it("the edit route refuses content changes on an issued quote, the delete route refuses an issued one, and e-mail sends only a revision", () => {
    const patch = read("src/app/api/standard-quotes/[id]/route.ts");
    expect(patch).toMatch(/isLockedByIssue\(before, revActive\)/);
    expect(patch).toMatch(/lockedKeysIn\(body\)/);
    expect(patch).toMatch(/current_revision != null/);
    expect(read("src/app/api/standard-quotes/[id]/email/route.ts")).toMatch(/revision_state !== "issued"/);
  });
  it("the PDF route prints any revision from its snapshot and the issued one by default", () => {
    const pdf = read("src/app/api/standard-quotes/[id]/pdf/route.ts");
    expect(pdf).toMatch(/searchParams\.get\("rev"\)/);
    expect(pdf).toMatch(/loadRevisionSnapshot\(/);
    expect(pdf).toMatch(/buildFrameFromSnapshot\(/);
  });
});

// ── copy to a new quotation, behaviour ────────────────────────────────────────────────────────────────────────────────
let db: ReturnType<typeof fakeDb>;
vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: db.client, tenantId: "t1", userId: "u1", role: "member" }),
  getAuthUser: async () => ({ id: "u1", email: "u@x.test" }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async () => true }));
vi.mock("@/lib/changeLog", () => ({ logChange: vi.fn(async () => {}), diffForLog: () => [] }));
vi.mock("@/lib/events/emitters", () => ({ emitQuoteCreated: vi.fn(async () => {}) }));
vi.mock("@/lib/pricing/quoteLineFlags", async () => {
  const real = await vi.importActual<typeof import("@/lib/pricing/quoteLineFlags")>("@/lib/pricing/quoteLineFlags");
  return { ...real, derivePricingFlags: async () => ({ ok: false }) };
});

const copyRoute = await import("@/app/api/standard-quotes/[id]/copy/route");
const ctx = { params: Promise.resolve({ id: "q1" }) };
const post = () => new NextRequest("http://acme.test/api/standard-quotes/q1/copy", { method: "POST" });

beforeEach(() => {
  db = fakeDb({
    tenants: [{ id: "t1", config: {} }],
    standard_quotes: [
      { id: "q1", tenant_id: "t1", ref: "SQ-2026-0001", account_id: "a1", contact_id: null, status: "sent", header_discount_pct: 0, tax_pct: 0, shipping_amount: 0, terms: "T", notes: null, intro_text: null,
        template_id: null, print_options: null, project_title: "P", subject: "S", entity_id: "e1", doc_sections: { x: 1 }, current_revision: 2, revision_state: "issued", created_at: "2026-08-01T00:00:00Z" },
      { id: "other", tenant_id: "t2", ref: "SQ-2026-0009", account_id: "a9", status: "draft" },
    ],
    standard_quote_lines: [
      { id: "l1", tenant_id: "t1", standard_quote_id: "q1", sl_no: "1", description: "A", uom: "No", qty: 2, rate: 100, discount_pct: 0, amount: 200, is_selected: true, show_on_pdf: true },
      { id: "l2", tenant_id: "t1", standard_quote_id: "q1", sl_no: "2", description: "B", uom: "No", qty: 1, rate: 50, discount_pct: 0, amount: 50, is_selected: true, show_on_pdf: true },
    ],
  });
});

describe("copy to a new quotation", () => {
  it("makes a NEW record with a new number, a draft, no revision history, made from the old one; the original is untouched", async () => {
    const res = await copyRoute.POST(post() as never, ctx);
    expect(res.status).toBe(201);
    const made = db.tables.standard_quotes.find((q) => q.id !== "q1" && q.tenant_id === "t1")!;
    expect(made.ref).not.toBe("SQ-2026-0001");
    expect(made).toMatchObject({ status: "draft", source_type: "standard_quote", source_id: "q1", project_title: "P", total: 250, opportunity_id: null, terms: "T" });
    expect(made.current_revision).toBeUndefined();
    expect(made.revision_state).toBeUndefined();
    const lines = db.tables.standard_quote_lines.filter((l) => l.standard_quote_id === made.id);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.id !== "l1" && l.id !== "l2")).toBe(true);
    expect(db.tables.standard_quotes.find((q) => q.id === "q1")).toMatchObject({ status: "sent", current_revision: 2, revision_state: "issued" });
  });

  it("never copies another workspace's quotation", async () => {
    const res = await copyRoute.POST(post() as never, { params: Promise.resolve({ id: "other" }) });
    expect(res.status).toBe(404);
    expect(db.tables.standard_quotes).toHaveLength(2);
  });
});
