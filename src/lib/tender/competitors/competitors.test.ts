import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { featureForObject } from "@/lib/objectFeatures";
import { tipTextProblems } from "@/lib/infoTip";
import { scopeForChangeType } from "@/lib/api/changeFeedScope";
import {
  COMPETITOR_LIMITS, competitorStats, findByName, inDisplayOrder, normaliseWebsite, parseCompetitorEdit, parseNewCompetitor, priceGap, readEvidence, readResearchAnswers, sameCompany, sourceHost,
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

  it("the header counts accepted competitors, those expected to be cheaper out of those with a price view, the proposals and the winner", () => {
    expect(competitorStats([])).toEqual({ total: 0, cheaper: 0, priced: 0, proposed: 0, winner: null });
    expect(competitorStats([
      { name: "A", expected_price: "lower", is_winner: false, status: "accepted" }, { name: "B", expected_price: "higher", is_winner: true, status: "accepted" }, { name: "C", expected_price: null, is_winner: false, status: "accepted" },
    ])).toEqual({ total: 3, cheaper: 1, priced: 2, proposed: 0, winner: "B" });
  });

  it("a proposal is not a competitor yet: it is counted as proposed only, and never as cheaper, priced or the winner", () => {
    expect(competitorStats([
      { name: "A", expected_price: "lower", is_winner: false, status: "accepted" },
      { name: "P", expected_price: "lower", is_winner: true, status: "proposed" },
      { name: "R", expected_price: "lower", is_winner: false, status: "rejected" },
    ])).toEqual({ total: 1, cheaper: 1, priced: 1, proposed: 1, winner: null });
  });

  it("shows the winner first, then the accepted ones in the team's order, then the proposals", () => {
    const rows = [{ n: "a", is_winner: false, sort: 1, created_at: "2026-10-01" }, { n: "b", is_winner: true, sort: 5, created_at: "2026-10-03" }, { n: "c", is_winner: false, sort: 0, created_at: "2026-10-02" }];
    expect(inDisplayOrder(rows).map((r) => r.n)).toEqual(["b", "c", "a"]);
    const mixed = [
      { n: "p1", is_winner: false, sort: 0, created_at: "2026-10-01", status: "proposed" as const },
      { n: "a1", is_winner: false, sort: 3, created_at: "2026-10-02", status: "accepted" as const },
      { n: "a0", is_winner: false, sort: 1, created_at: "2026-10-03", status: "accepted" as const },
    ];
    expect(inDisplayOrder(mixed).map((r) => r.n)).toEqual(["a0", "a1", "p1"]);
  });

  it("an edit takes Accept or Reject for a proposal and nothing else as a status", () => {
    expect(parseCompetitorEdit({ status: "accepted" })).toEqual({ ok: true, value: { status: "accepted" } });
    expect(parseCompetitorEdit({ status: "rejected" })).toEqual({ ok: true, value: { status: "rejected" } });
    for (const bad of ["proposed", "approved", "", null, 1]) expect(parseCompetitorEdit({ status: bad }), String(bad)).toMatchObject({ ok: false });
    // A new competitor cannot arrive as proposed or carry evidence: those only come from the research route.
    expect(parseNewCompetitor({ name: "X", status: "proposed", origin: "research", evidence: { v: 1 } })).toEqual({ ok: true, value: { name: "X", website: null, country: null, expected_price: null, strengths: null, notes: null } });
  });
});

describe("the evidence a screen is given", () => {
  const fact = { text: "Won the Jubail award", kind: "award", source_url: "https://news.example.com/a", source_title: "News", published_on: "2025-06-02" };
  const good = { v: 1, facts: [fact], price: { text: "Comparable award SAR 1.9 million", amount: 1900000, source_url: "https://news.example.com/a" }, wins: { text: "Beat us in 2024", source_url: "https://news.example.com/b" }, researched_at: "2026-10-29T08:00:00Z", model: "m" };

  it("keeps well-formed evidence as it is", () => {
    expect(readEvidence(good)).toEqual(good);
  });

  it("drops anything stored without an https source: no source, no fact", () => {
    const e = readEvidence({ ...good, facts: [fact, { ...fact, source_url: "http://plain.example.com" }, { ...fact, source_url: "javascript:alert(1)" }, { ...fact, source_url: "" }, { ...fact, text: "  " }], price: { ...good.price, source_url: "http://x.example.com" }, wins: { text: "x", source_url: "ftp://x" } });
    expect(e?.facts).toHaveLength(1);
    expect(e?.price).toBeNull();
    expect(e?.wins).toBeNull();
  });

  it("is null for nothing usable: another version, a malformed value, or no fact, price or win left", () => {
    for (const bad of [null, undefined, "x", 7, [], { v: 2, facts: [fact] }, { v: 1 }, { v: 1, facts: "no" }, { v: 1, facts: [{ ...fact, source_url: "http://a.example.com" }] }]) expect(readEvidence(bad), JSON.stringify(bad)).toBeNull();
  });

  it("an amount is a figure above zero or nothing; an unknown kind reads as other", () => {
    const e = readEvidence({ ...good, price: { ...good.price, amount: -5 }, facts: [{ ...fact, kind: "rumour" }] });
    expect(e?.price?.amount).toBeNull();
    expect(e?.facts[0].kind).toBe("other");
    expect(readEvidence({ ...good, price: { ...good.price, amount: "1900000" } })?.price?.amount).toBeNull();
  });

  it("names a page by its host without www", () => {
    expect(sourceHost("https://www.rival.com/about")).toBe("rival.com");
    expect(sourceHost("not a url")).toBe("not a url");
  });

  it("sets their likely price against our bid as a signed percent of our bid, and says nothing without both figures", () => {
    expect(priceGap(1_900_000, 2_000_000)).toEqual({ pct: -5, label: "-5.0%" });
    expect(priceGap(2_100_000, 2_000_000)).toEqual({ pct: 5, label: "+5.0%" });
    expect(priceGap(2_000_000, 2_000_000)).toEqual({ pct: 0, label: "0.0%" });
    for (const [a, b] of [[null, 100], [100, null], [0, 100], [100, 0], [Number.NaN, 100]] as const) expect(priceGap(a, b), `${a}/${b}`).toBeNull();
  });

  it("research answers are read only when all three are known values", () => {
    expect(readResearchAnswers({ scope: "supply", region: "gcc", issuer_type: "semi", answered_at: "2026-10-29T08:00:00Z" })).toEqual({ scope: "supply", region: "gcc", issuer_type: "semi", answered_at: "2026-10-29T08:00:00Z" });
    expect(readResearchAnswers({ scope: "supply", region: "gcc" })).toBeNull();
    expect(readResearchAnswers({ scope: "install", region: "gcc", issuer_type: "private" })).toBeNull();
    expect(readResearchAnswers({ scope: "supply", region: "mars", issuer_type: "private" })).toBeNull();
    expect(readResearchAnswers(null)).toBeNull();
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

describe("migration 0239", () => {
  const sql39 = lf(read("supabase/migrations/0239_competitor_research.sql"));
  const code39 = sql39.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");

  it("is guarded on 0229 and idempotent", () => {
    expect(code39).toMatch(/to_regclass\('public\.opportunity_competitors'\) is null/);
    expect(code39).toMatch(/add column if not exists status text not null default 'accepted' check \(status in \('proposed', 'accepted', 'rejected'\)\)/);
    expect(code39).toMatch(/add column if not exists origin text not null default 'manual' check \(origin in \('manual', 'research'\)\)/);
    expect(code39).toMatch(/add column if not exists evidence jsonb/);
    expect(code39).toMatch(/create index if not exists opportunity_competitors_status_idx on opportunity_competitors \(tenant_id, opportunity_id, status\)/);
  });

  it("adds columns to the one table and creates no table or policy (0229's select-only RLS covers the new columns: a member cannot write evidence)", () => {
    expect(code39).not.toMatch(/create table|create policy|drop policy|for (all|insert|update|delete)/i);
    expect(code39).not.toMatch(/alter table (?!opportunity_competitors )/i);
  });

  it("every earlier row stays the team's own: the default makes it accepted and manual", () => {
    expect(code39).toContain("default 'accepted'");
    expect(code39).toContain("default 'manual'");
  });

  it("the bundle carries the migration verbatim, and the ledger lists it as pending", () => {
    const bundle = lf(read("scripts/run-bundle-47-competitor-research-2026-10-29.sql"));
    expect(bundle).toContain(sql39.trim());
    const project = read("PROJECT.md");
    expect(project).toMatch(/0239_competitor_research\.sql -- PENDING/);
    expect(project).toMatch(/run-bundle-47-competitor-research-2026-10-29\.sql/);
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
    const files = ["CompetitorsTab.tsx", "CompetitorDetailPanel.tsx", "CompetitorPanel.tsx", "WhoWonPicker.tsx"].map((f) => read(`src/components/tender/competitors/${f}`)).join("\n");
    const ids = new Set([...files.matchAll(/"(competitor\.[a-z_.]+)"/g)].map((m) => m[1]));
    for (const id of ["competitor.add", "competitor.suggest", "competitor.table", "competitor.row", "competitor.open", "competitor.insights", "competitor.accept", "competitor.reject", "competitor.edit", "competitor.winner", "competitor.remove", "competitor.save", "competitor.field.name", "competitor.tab", "competitor.detail", "competitor.evidence"]) expect(ids, id).toContain(id);
  });
});
