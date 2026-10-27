import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { tipTextProblems } from "@/lib/infoTip";
import { scopeForChangeType } from "@/lib/api/changeFeedScope";
import {
  COMPETITOR_LIMITS, analyseAllSentence, competitorStats, findByName, inDisplayOrder, normaliseWebsite, parseCompetitorEdit, parseNewCompetitor, sameCompany,
} from "./rules";
import { COMPETITOR_TIPS } from "./tips";

// GCC tender deals, the Competitors tab: the field rules, the explanations behind the "i", the shape of migration 0229 and the bundle that
// carries it, the ledger, the gating map and the places the new object has to be listed.

const ROOT = path.resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const lf = (s: string) => s.replace(/\r\n/g, "\n");
const sql = lf(read("supabase/migrations/0229_opportunity_competitors.sql"));
const code = sql.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

describe("the field rules", () => {
  it("normalises a website to https://host/path and refuses anything that is not a web address", () => {
    expect(normaliseWebsite("www.Rival.com/about/?utm=1#x")).toBe("https://www.rival.com/about");
    expect(normaliseWebsite("http://rival.com")).toBe("https://rival.com");
    expect(normaliseWebsite("  ")).toBeNull();
    expect(normaliseWebsite(undefined)).toBeNull();
    for (const bad of ["javascript:alert(1)", "ftp://rival.com", "not a site", "rival", "https://user:pw@rival.com", "https://rival.com:8443", "https://-bad-.com"]) expect(normaliseWebsite(bad), bad).toBeUndefined();
    expect((normaliseWebsite(`rival.com/${"a".repeat(400)}`) ?? "").length).toBeLessThanOrEqual(COMPETITOR_LIMITS.websiteMax);
  });

  it("a new competitor needs a name and takes only the allow-listed fields", () => {
    expect(parseNewCompetitor({})).toMatchObject({ ok: false });
    expect(parseNewCompetitor({ name: "  " })).toMatchObject({ ok: false });
    const ok = parseNewCompetitor({ name: " Rival   Co ", website: "rival.com", expected_price: "similar", is_winner: true, tenant_id: "t2", created_by: "x", sort: 9 });
    expect(ok).toEqual({ ok: true, value: { name: "Rival Co", website: "https://rival.com", country: null, expected_price: "similar", strengths: null, notes: null } });
    expect(parseNewCompetitor({ name: "X", expected_price: "cheap" })).toMatchObject({ ok: false });
    expect(parseNewCompetitor({ name: "x".repeat(COMPETITOR_LIMITS.nameMax + 1) })).toMatchObject({ ok: false });
    expect(parseNewCompetitor({ name: "X", strengths: "s".repeat(COMPETITOR_LIMITS.strengthsMax + 1) })).toMatchObject({ ok: false });
    expect(parseNewCompetitor({ name: "X", notes: "n".repeat(COMPETITOR_LIMITS.notesMax + 1) })).toMatchObject({ ok: false });
  });

  it("an edit returns only the keys present, clears a field with an empty value, and takes the winner flag as a boolean", () => {
    expect(parseCompetitorEdit({})).toMatchObject({ ok: false });
    expect(parseCompetitorEdit({ notes: "" })).toEqual({ ok: true, value: { notes: null } });
    expect(parseCompetitorEdit({ expected_price: null, country: " KSA " })).toEqual({ ok: true, value: { expected_price: null, country: "KSA" } });
    expect(parseCompetitorEdit({ is_winner: true })).toEqual({ ok: true, value: { is_winner: true } });
    expect(parseCompetitorEdit({ is_winner: "yes" })).toMatchObject({ ok: false });
    expect(parseCompetitorEdit({ name: "" })).toMatchObject({ ok: false });
    expect(parseCompetitorEdit({ tenant_id: "t2", opportunity_id: "o" })).toMatchObject({ ok: false });
  });

  it("the same company is the same whatever the case or the spacing", () => {
    expect(sameCompany("Rival  Co", " rival co")).toBe(true);
    expect(sameCompany("Rival Co", "Rival Company")).toBe(false);
    expect(findByName([{ name: "A" }, { name: "Rival Co" }], "RIVAL co")).toEqual({ name: "Rival Co" });
    expect(findByName([{ name: "A" }], "B")).toBeNull();
  });

  it("the strip counts competitors, those expected to be cheaper out of those with a price view, and the winner", () => {
    expect(competitorStats([])).toEqual({ total: 0, cheaper: 0, priced: 0, winner: null });
    expect(competitorStats([
      { name: "A", expected_price: "lower", is_winner: false }, { name: "B", expected_price: "higher", is_winner: true }, { name: "C", expected_price: null, is_winner: false },
    ])).toEqual({ total: 3, cheaper: 1, priced: 2, winner: "B" });
  });

  it("shows the winner first, then the team's order", () => {
    const rows = [{ n: "a", is_winner: false, sort: 1, created_at: "2026-10-01" }, { n: "b", is_winner: true, sort: 5, created_at: "2026-10-03" }, { n: "c", is_winner: false, sort: 0, created_at: "2026-10-02" }];
    expect(inDisplayOrder(rows).map((r) => r.n)).toEqual(["b", "c", "a"]);
  });

  it("Analyse all states the number of analyses it will run", () => {
    expect(analyseAllSentence(1)).toContain("1 company analysis,");
    expect(analyseAllSentence(4)).toContain("4 company analyses");
  });
});

describe("the explanations", () => {
  it.each(Object.entries(COMPETITOR_TIPS))("%s fits behind an i", (_key, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });
});

describe("migration 0229", () => {
  it("is guarded and idempotent", () => {
    expect(code).toContain("to_regclass('public.opportunities') is null");
    for (const m of code.matchAll(/create table (if not exists )?(\w+)/gi)) expect(m[1], `create table ${m[2]}`).toBeTruthy();
    for (const m of code.matchAll(/create (unique )?index (if not exists )?(\w+)/gi)) expect(m[2], `index ${m[3]}`).toBeTruthy();
    for (const m of code.matchAll(/create policy "([^"]+)"/gi)) expect(code, m[1]).toContain(`drop policy if exists "${m[1]}"`);
  });

  it("has tenant_id, RLS and a tenant SELECT policy and NOTHING that writes (a member must not edit the recorded winner)", () => {
    expect(code).toMatch(/create table if not exists opportunity_competitors \([^;]*?tenant_id uuid not null references tenants\(id\)/);
    expect(code).toMatch(/opportunity_id uuid not null references opportunities\(id\) on delete cascade/);
    expect(code).toMatch(/alter table opportunity_competitors enable row level security/);
    const policies = [...code.matchAll(/create policy "([^"]+)" on opportunity_competitors for (\w+)/gi)];
    expect(policies).toHaveLength(1);
    expect(policies[0][2].toLowerCase()).toBe("select");
    expect(code).toMatch(/for select using \(tenant_id in \(select tenant_id from tenant_users where user_id = auth\.uid\(\)\)\)/);
    expect(code).not.toMatch(/for (all|insert|update|delete)/i);
  });

  it("has the columns the code reads, the price view check, one winner per deal and a name once per deal", () => {
    for (const col of ["name", "website", "country", "expected_price", "strengths", "notes", "is_winner", "sort", "created_by", "created_at", "updated_at"]) expect(code, col).toMatch(new RegExp(`\\b${col}\\b`));
    expect(code).toMatch(/expected_price in \('lower', 'similar', 'higher'\)/);
    expect(code).toMatch(/create unique index if not exists opportunity_competitors_one_winner on opportunity_competitors \(opportunity_id\) where is_winner/);
    expect(code).toMatch(/create unique index if not exists opportunity_competitors_name_unique on opportunity_competitors \(opportunity_id, lower\(name\)\)/);
    expect(code).toMatch(/index if not exists opportunity_competitors_deal on opportunity_competitors \(tenant_id, opportunity_id\)/);
  });

  it("the column limits match the code's limits", () => {
    expect(code).toContain(`char_length(name) between 1 and ${COMPETITOR_LIMITS.nameMax}`);
    expect(code).toContain(`char_length(website) <= ${COMPETITOR_LIMITS.websiteMax}`);
    expect(code).toContain(`char_length(country) <= ${COMPETITOR_LIMITS.countryMax}`);
    expect(code).toContain(`char_length(strengths) <= ${COMPETITOR_LIMITS.strengthsMax}`);
    expect(code).toContain(`char_length(notes) <= ${COMPETITOR_LIMITS.notesMax}`);
  });

  it("changes no existing table", () => {
    expect(code).not.toMatch(/alter table (?!opportunity_competitors)/i);
  });

  it("the bundle carries the migration verbatim, and the ledger lists it as pending", () => {
    const bundle = lf(read("scripts/run-bundle-40-opportunity-competitors-2026-10-27.sql"));
    expect(bundle).toContain(sql.trim());
    const project = read("PROJECT.md");
    expect(project).toMatch(/0229_opportunity_competitors\.sql -- PENDING/);
    expect(project).toMatch(/run-bundle-40-opportunity-competitors-2026-10-27\.sql/);
  });
});

describe("wiring", () => {
  it("the object is owned by the tender module, and its change-feed entries need the tenders scope", () => {
    expect(featureForObject("opportunity_competitors")).toBe("gcc_tender");
    expect(scopeForChangeType("opportunity_competitors")).toBe("tenders");
  });

  it("is in the change-history filter and on the deal's Activity tab", () => {
    expect(read("src/app/(app)/administration/change-history/ChangeHistoryClient.tsx")).toContain('value: "opportunity_competitors"');
    expect(read("src/app/(app)/pipeline/[id]/page.tsx")).toContain('["opportunity_tenders", "opportunity_competitors"]');
  });

  it("every route writes through the service-role client with the workspace and the deal, after the one tender gate", () => {
    for (const f of [
      "src/app/api/opportunities/[id]/competitors/route.ts",
      "src/app/api/opportunities/[id]/competitors/[competitorId]/route.ts",
      "src/app/api/opportunities/[id]/competitors/[competitorId]/insights/route.ts",
    ]) {
      const src = read(f);
      expect(src, f).toContain("openTenderDealRequest(");
      expect(src, f).not.toMatch(/request\.json\(\)[^;]*tenant/);
    }
    const server = read("src/lib/tender/competitors/server.ts");
    for (const m of server.matchAll(/admin\.from\("opportunity_competitors"\)[\s\S]*?(?=\n\s*(?:if|const|return|let|await|\}))/g)) expect(m[0], m[0]).toMatch(/tenant_id/);
  });

  it("the insights route takes the company from the stored competitor and never from the request", () => {
    const src = read("src/app/api/opportunities/[id]/competitors/[competitorId]/insights/route.ts");
    expect(src).toContain("name: row.name");
    expect(src).not.toMatch(/body\)?\.(name|domain|country|account_id|allow_web)/);
  });

  it("the stage move to Lost and the Outcome save record the winner by name", () => {
    expect(read("src/app/api/opportunities/[id]/route.ts")).toContain("recordWinnerByName(");
    expect(read("src/app/api/opportunities/[id]/tender/outcome/route.ts")).toContain("recordWinnerByName(");
  });

  it("the capability text and the design doc describe the tab", () => {
    expect(read("docs/capabilities/gcc_tender.md")).toMatch(/Competitors tab/);
    expect(read("docs/design/gcc-tender-deals.md")).toMatch(/## 22\. Competitors as built/);
  });

  it("every control on the tab carries a data-guide id the assistant can point at", () => {
    const files = ["CompetitorsTab.tsx", "CompetitorCard.tsx", "CompetitorPanel.tsx", "WhoWonPicker.tsx"].map((f) => read(`src/components/tender/competitors/${f}`)).join("\n");
    const ids = new Set([...files.matchAll(/"(competitor\.[a-z_.]+)"/g)].map((m) => m[1]));
    for (const id of ["competitor.add", "competitor.insights", "competitor.analyse_all", "competitor.edit", "competitor.save", "competitor.field.name", "competitor.tab", "competitor.strip"]) expect(ids, id).toContain(id);
  });
});
