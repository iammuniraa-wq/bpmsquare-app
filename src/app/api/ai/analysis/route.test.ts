import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

const { resolve, analyse, readCached } = vi.hoisted(() => ({ resolve: vi.fn(), analyse: vi.fn(), readCached: vi.fn() }));

vi.mock("@/lib/analysis/access", async (orig) => ({ ...(await orig<typeof import("@/lib/analysis/access")>()), resolveAnalysisAccess: resolve }));
vi.mock("@/lib/analysis/service", () => ({ analyseCompany: analyse, readCachedAnalysis: readCached }));

import { GET, POST } from "./route";

const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const post = (body: unknown) => ({ json: async () => body }) as never;
const get = (qs: string) => ({ nextUrl: new URL(`http://x/api/ai/analysis?${qs}`) }) as never;

beforeEach(() => {
  resolve.mockReset().mockResolvedValue({ tenantId: "t1" });
  analyse.mockReset();
  readCached.mockReset();
});

describe("POST /api/ai/analysis", () => {
  it("passes a session failure straight through", async () => {
    resolve.mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await POST(post({}))).status).toBe(401);
    expect(analyse).not.toHaveBeenCalled();
  });
  it("rejects an account id that is not an id", async () => {
    expect((await POST(post({ account_id: "x" }))).status).toBe(400);
    expect(analyse).not.toHaveBeenCalled();
  });
  it("maps the service's refusals to their status: flag off 403, other workspace 404, cap 429", async () => {
    for (const status of [403, 404, 429]) {
      analyse.mockResolvedValueOnce({ ok: false, status, code: "c", error: "no" });
      const res = await POST(post({ account_id: ACC, allow_web: true }));
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ error: "no", code: "c" });
    }
  });
  it("returns the card with how it was made, and sends only the named fields to the service", async () => {
    analyse.mockResolvedValueOnce({ ok: true, card: { name: "Najd" }, cached: true, saved: true, pendingDb: false, notice: { kind: "no_web" } });
    const res = await POST(post({ account_id: ACC, allow_web: true, tenant_id: "other", secret: "x" }));
    expect(await res.json()).toEqual({ card: { name: "Najd" }, cached: true, saved: true, pendingDb: false, notice: { kind: "no_web" } });
    expect(analyse.mock.calls[0][1]).toEqual({ accountId: ACC, name: undefined, domain: undefined, country: undefined, refresh: false, allowWeb: true });
  });
  it("a service crash is a plain 500, not a stack", async () => {
    analyse.mockRejectedValueOnce(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(post({ account_id: ACC }));
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/boom/);
  });
});

describe("GET /api/ai/analysis", () => {
  it("reads the saved card only", async () => {
    readCached.mockResolvedValueOnce({ ok: true, card: null, pendingDb: true });
    const res = await GET(get(`account_id=${ACC}`));
    expect(await res.json()).toEqual({ card: null, pendingDb: true });
    expect(analyse).not.toHaveBeenCalled();
  });
  it("refuses when the flag is off", async () => {
    readCached.mockResolvedValueOnce({ ok: false, status: 403, code: "flag_off", error: "off" });
    expect((await GET(get(`account_id=${ACC}`))).status).toBe(403);
  });
});

describe("migration 0206", () => {
  const dir = path.resolve(__dirname, "../../../../../supabase/migrations");
  const file = readFileSync(path.join(dir, "0206_company_analysis.sql"), "utf8");
  const code = file.replace(/--[^\n]*/g, "");

  it("is tenant-scoped, has row level security and only a member SELECT policy", () => {
    expect(code).toMatch(/tenant_id\s+uuid not null references tenants\(id\)/);
    expect(code).toMatch(/alter table company_analyses enable row level security/);
    const policies = [...code.matchAll(/create policy "([^"]+)" on (\w+) for (\w+)/gi)];
    expect(policies.map((p) => [p[2], p[3].toLowerCase()])).toEqual([["company_analyses", "select"]]);
    expect(code).toMatch(/unique index if not exists company_analyses_key on company_analyses \(tenant_id, company_key\)/);
  });
  it("is idempotent", () => {
    expect(code).toMatch(/create table if not exists company_analyses/);
    expect(code).toMatch(/drop policy if exists "company_analyses: tenant read"/);
    expect(code.match(/create (unique )?index/gi)!.every((_, i, a) => a.length === code.match(/create (unique )?index if not exists/gi)!.length)).toBe(true);
  });
  it("its bundle carries it verbatim", () => {
    const bundle = readFileSync(path.resolve(__dirname, "../../../../../scripts/run-bundle-15-company-analysis-2026-10-22.sql"), "utf8");
    expect(bundle.replace(/\r\n/g, "\n")).toContain(file.replace(/\r\n/g, "\n").trim());
  });
});
