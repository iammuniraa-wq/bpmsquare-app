import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { STAGES } from "@/lib/signals/types";
import { CLAIM_KINDS, FIT_LABELS, VERDICT_LABELS } from "./types";

// scripts/seed-company-analysis-demo.sql: run by hand on the demo workspace after migration 0206. These checks hold its
// shape (a demo-only, idempotent, no-delete script whose JSON uses the words the code reads) without a database.

const sql = readFileSync("scripts/seed-company-analysis-demo.sql", "utf8");
const body = sql.replace(/^--.*$/gm, "");
const all = (re: RegExp) => [...body.matchAll(re)].map((m) => m[1]);

describe("the company analysis demo seed", () => {
  it("touches only demo workspaces and never removes or rewrites anything of a client", () => {
    for (const m of body.matchAll(/from tenants[^;]*;|update tenants[^;]*;/gi)) expect(m[0]).toMatch(/is_demo = true/);
    expect(body).not.toMatch(/\b(delete|truncate|drop|alter)\b/i);
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // The only account change is a made-up website on a demo account that has none.
    expect(all(/update (\w+)\s+set/gi).sort()).toEqual(["accounts", "tenants"]);
    expect(body).toMatch(/update accounts set website = v_site where id = a\.id and tenant_id = t\.id/);
  });

  it("is idempotent: a company already analysed in the workspace is left alone", () => {
    expect(body).toMatch(/if exists \(select 1 from company_analyses where tenant_id = t\.id and company_key = v_domain\) then\s+continue;/);
    expect(body).toMatch(/on conflict \(tenant_id, company_key\) do nothing/);
  });

  it("switches the flag on only where the assistant is already on, and never turns anything off", () => {
    expect(body).toMatch(/'\{"ai_assistant_web": true\}'/);
    expect(body).toMatch(/ai_assistant'\)::boolean, false\) = true/);
    expect(body).not.toMatch(/"ai_assistant_web": false/);
  });

  it("is told to run after 0206, and gives two fresh analyses and one older than seven days", () => {
    expect(sql).toMatch(/AFTER supabase\/migrations\/0206_company_analysis\.sql/);
    expect(body).toContain("interval '3 days'");
    expect(body).toContain("interval '1 day'");
    expect(body).toContain("interval '9 days'");
    expect(body).toContain("v_computed + interval '7 days'");
    expect(body).toMatch(/limit 3/);
  });

  it("writes the shape the code reads: the stored research, a snapshot and sources, marked as sample", () => {
    for (const k of ["'v', 1", "'sample', true", "'claims', v_claims", "'checkThese'", "'sources', v_sources", "'sentence', v_sentence", "'snapshot'"]) expect(body).toContain(k);
    for (const k of ["'text'", "'kind'", "'confidence', 'found'", "'stale', false", "'publishedOn'", "'source'"]) expect(body).toContain(k);
    for (const k of all(/'kind', '(\w+)'/g)) expect(CLAIM_KINDS, k).toContain(k);
    for (const k of all(/v_verdict := '(\w+)'/g)) expect(VERDICT_LABELS, k).toContain(k);
    for (const k of all(/v_fit := '(\w+)'/g)) expect(FIT_LABELS, k).toContain(k);
    for (const k of all(/v_stage := '(\w+)'/g)) expect(STAGES, k).toContain(k);
  });

  it("uses only https addresses on reserved example domains, so nothing real is named or fetched", () => {
    const urls = [...body.matchAll(/'(https?:\/\/[^']+)'/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/^https:\/\/[a-z]+\.example(\.com)?(\/|$)/);
    expect(body).toContain("|| '.example'");
  });
});
