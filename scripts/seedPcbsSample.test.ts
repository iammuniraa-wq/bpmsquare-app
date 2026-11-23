import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { generate } from "./gen-pcbs-sample-estimates";

// scripts/seed-pcbs-sample.sql and its cleanup are run by hand on the dedicated PCBS project. They write real rows, so this file pins the
// rules that keep them safe: only the 'pcbs' workspace, every row in the reserved id range the cleanup deletes by, every insert carrying
// tenant_id, only tables and columns the migrations really create, no product anywhere (PCBS imports its real item master from F&O), no
// PII, no real names, and a cleanup that can only reach the seed's own rows. (The scripts were also run against all migrations 0000-0252
// in a real Postgres, twice, cleaned up, and run again; see the commit message.)

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

/** Replaces the JSON dollar-quoted bodies the generator writes with a placeholder, so their quotes and semicolons cannot confuse the readers below. */
const maskJson = (sql: string) => sql.replace(/\$(inputs|rates|rules|params|totals|model|cd|visual)\$[\s\S]*?\$\1\$/g, "'JSON'");

/** Removes `-- ...` comments, leaving string literals untouched. */
function stripComments(sql: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      out += c;
      if (c === "'") inStr = false;
      continue;
    }
    if (c === "'") { inStr = true; out += c; continue; }
    if (c === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += c;
  }
  return out;
}

function statementFrom(code: string, from: number): string {
  let inStr = false;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === "'") inStr = !inStr;
    else if (c === ";" && !inStr) return code.slice(from, i);
  }
  return code.slice(from);
}

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (const c of s) {
    if (c === "'") inStr = !inStr;
    if (!inStr) {
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function balanced(s: string, open: number): string {
  let depth = 0;
  let inStr = false;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'") inStr = !inStr;
    if (inStr) continue;
    if (c === "(") depth++;
    if (c === ")") { depth--; if (depth === 0) return s.slice(open + 1, i); }
  }
  return s.slice(open + 1);
}

const rawSeed = read("scripts/seed-pcbs-sample.sql");
const rawCleanup = read("scripts/seed-pcbs-sample-cleanup.sql");
const seed = stripComments(maskJson(rawSeed));
const cleanup = stripComments(rawCleanup);

type Insert = { table: string; cols: string[]; stmt: string };
function inserts(code: string): Insert[] {
  const out: Insert[] = [];
  const re = /insert\s+into\s+([a-z_0-9.]+)\s*(\(|values|select)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const table = m[1].replace(/^public\./, "");
    const stmt = statementFrom(code, m.index);
    const open = stmt.indexOf("(");
    const cols = m[2] === "(" ? splitTop(balanced(stmt, open)).map((c) => c.trim().toLowerCase()) : [];
    out.push({ table, cols, stmt });
  }
  return out;
}

// ---- What the migrations create ----------------------------------------------------------------------------------------------------
const migrationDir = path.join(ROOT, "supabase/migrations");
const migrationText = readdirSync(migrationDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => stripComments(readFileSync(path.join(migrationDir, f), "utf8").replace(/\r\n/g, "\n")))
  .join("\n;\n");

const tableColumns = new Map<string, Set<string>>();
{
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_0-9]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(migrationText))) {
    const cols = tableColumns.get(m[1]) ?? new Set<string>();
    for (const el of splitTop(balanced(migrationText, m.index + m[0].length - 1))) {
      const word = el.trim().split(/\s+/)[0].toLowerCase().replace(/"/g, "");
      if (!["constraint", "primary", "unique", "check", "foreign", "like", "exclude"].includes(word) && word) cols.add(word);
    }
    tableColumns.set(m[1], cols);
  }
  const alter = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?([a-z_0-9]+)\s+([^;]*)/gi;
  while ((m = alter.exec(migrationText))) {
    const cols = tableColumns.get(m[1]);
    if (!cols) continue;
    for (const a of m[2].matchAll(/add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_0-9]+)/gi)) cols.add(a[1].toLowerCase());
  }
}

/** The id kind of every table the seed fills (the comment block at the top of the seed). */
const KIND: Record<string, number> = {
  accounts: 1, contacts: 2, suppliers: 3, estimate_templates: 5, estimates: 6, estimate_lines: 7, opportunities: 8, opportunity_lines: 9,
  tender_bid_versions: 11, rfqs: 12, rfq_lines: 13, rfq_suppliers: 14, rfq_responses: 15, standard_quotes: 16, standard_quote_lines: 17,
  quotes: 18, quote_lines: 19, quote_revisions: 20, contract_projects: 21, project_budget_revisions: 22, project_budget_lines: 23,
  project_work_packages: 24, project_work_package_lines: 25, project_work_package_line_parts: 26, opportunity_competitors: 27, deal_activities: 28,
};
const MARKER = "5a3b1e00-5a3b-4000-8000-";

const all = inserts(seed);
const filled = new Set(all.map((i) => i.table));

describe("the seed script: whose workspace it writes to", () => {
  it("finds the workspace by the slug pcbs, in every block, and does nothing with a notice when there is none", () => {
    const reads = [...seed.matchAll(/from\s+tenants\b[^;]*/gi)].map((m) => m[0]);
    expect(reads.length).toBeGreaterThanOrEqual(9);
    for (const r of reads) expect(r, r).toMatch(/where\s+slug\s*=\s*'pcbs'/i);
    const blocks = [...seed.matchAll(/do\s+\$(\w+)\$([\s\S]*?)end\s+\$\1\$/g)];
    expect(blocks.length).toBeGreaterThanOrEqual(9);
    for (const [, tag, body] of blocks) {
      expect(body, `block ${tag} reads the tenant`).toMatch(/from tenants where slug = 'pcbs'/);
      expect(body, `block ${tag} stops quietly without a tenant`).toMatch(/if t is null then\s+(?:raise notice '[^']*';\s+)?return;/);
    }
  });

  it("never touches the tenants table, secrets, auth rows or sign-ins", () => {
    expect(seed).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+tenants\b/i);
    expect(seed).not.toMatch(/auth\.users|\bpassword\b|crypt\(|tenant_users|api_key|secret|service_role/i);
    expect(seed).not.toMatch(/is_demo/i);
  });

  it("is one transaction: begin before the first write, commit after the last", () => {
    expect(seed.trimStart().startsWith("begin;")).toBe(true);
    expect(seed.trimEnd().endsWith("commit;")).toBe(true);
    expect(cleanup.trimStart().startsWith("begin;")).toBe(true);
    expect(cleanup.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("checks the migrations it needs before it writes anything", () => {
    expect(seed).toMatch(/Run the missing migrations first[^']*0248, 0250, 0251 and 0252/);
    for (const c of ["standard_quotes.source_type", "standard_quotes.revision_state", "contract_projects.source_type", "project_work_packages.parent_id"]) {
      expect(seed, c).toContain(`'${c}'`);
    }
  });

  it("has one convention: each insert block is guarded by an exists check on its own reserved id", () => {
    for (const t of ["accounts", "contacts", "suppliers", "opportunities", "estimates", "standard_quotes", "quotes", "tender_bid_versions", "opportunity_competitors", "deal_activities", "rfqs", "contract_projects"]) {
      const re = new RegExp(`(?:not )?exists \\(select 1 from ${t} \\w+ where \\w+\\.tenant_id = t and \\w+\\.id = pg_temp\\.pcbs_id\\(${KIND[t]},`);
      expect(seed, t).toMatch(re);
    }
    expect(seed).not.toMatch(/on conflict[^;]*do update/i);
  });
});

describe("the seed script: what it writes", () => {
  it("every insert names its columns and carries tenant_id", () => {
    expect(all.length).toBeGreaterThanOrEqual(25);
    for (const i of all) {
      expect(i.cols.length, `insert into ${i.table} has no column list`).toBeGreaterThan(0);
      expect(i.cols, `insert into ${i.table}`).toContain("tenant_id");
    }
  });

  it("only inserts into tables, and columns, that the migrations create", () => {
    for (const i of all) {
      const cols = tableColumns.get(i.table);
      expect(cols, `${i.table} is not created by any migration`).toBeDefined();
      for (const c of i.cols) expect(cols!.has(c), `${i.table}.${c} is not created by any migration`).toBe(true);
    }
    for (const u of seed.matchAll(/update\s+([a-z_0-9]+)\s+(?:\w+\s+)?set\b[^;]*/gi)) {
      const cols = tableColumns.get(u[1])!;
      expect(cols, u[1]).toBeDefined();
      for (const s of u[0].matchAll(/\bset\s+([a-z_0-9]+)\s*=|,\s*([a-z_0-9]+)\s*=\s*(?!=)/gi)) {
        const col = (s[1] ?? s[2]).toLowerCase();
        if (["total", "subtotal"].includes(col) || cols.has(col)) continue;
        expect(cols.has(col), `${u[1]}.${col}`).toBe(true);
      }
      expect(u[0], u[0]).toMatch(/tenant_id\s*=\s*t\b/);
    }
  });

  it("every row written gets an id from the reserved range (the marker the cleanup deletes by)", () => {
    for (const [table, kind] of Object.entries(KIND)) {
      expect(filled.has(table), `${table} is filled`).toBe(true);
      const stmt = all.filter((i) => i.table === table).map((i) => i.stmt).join("\n");
      expect(stmt, table).toMatch(new RegExp(`pg_temp\\.pcbs_id\\(${kind},`));
      expect(all.find((i) => i.table === table)!.cols[0], `${table} lists id first`).toBe("id");
    }
    // The tender row is keyed by its deal, whose id is in the range.
    const tender = all.find((i) => i.table === "opportunity_tenders")!;
    expect(tender.cols[0]).toBe("opportunity_id");
    expect(tender.stmt).toMatch(/values \(pg_temp\.pcbs_id\(8, r\.n\)/);
    // Nothing is written that the table map does not know.
    for (const t of filled) expect(t === "opportunity_tenders" || KIND[t] !== undefined, t).toBe(true);
    expect(seed).toContain(`'${MARKER}'`);
    expect(rawSeed).toContain("5a3b1e00-5a3b-4000-8000-KKKKNNNNNNNN");
  });

  it("never writes a product, a product link or a product category (PCBS imports its real item master from F&O)", () => {
    expect(filled.has("products")).toBe(false);
    expect(filled.has("product_categories")).toBe(false);
    expect(seed).not.toMatch(/\bproducts\b|product_id|product_ref\s*[:=]\s*'|\bsku\b|pcbs_id\(4,/i);
    for (const i of all) expect(i.cols.filter((c) => /product|sku|category/.test(c)), i.table).toEqual([]);
    expect(rawSeed).toMatch(/NO products and no product categories/);
    expect(rawSeed).toMatch(/F&O item master/);
    // The generator reads no product either.
    const gen = read("scripts/gen-pcbs-sample-estimates.ts");
    expect(gen).not.toMatch(/products\b|product_id|starterCatalogue|productRowFor/);
  });

  it("makes refs the way the app does (the next free number) and gives documents their own SMP series", () => {
    expect(seed).toMatch(/pg_temp\.pcbs_ref\('accounts', t, 'ACC'\)/);
    expect(seed).toMatch(/pg_temp\.pcbs_ref\('opportunities', t, 'OPP'\)/);
    expect(seed).toMatch(/pg_temp\.pcbs_ref\('estimates', t, 'EST'\)/);
    expect(seed).toMatch(/pg_temp\.pcbs_ref\('contract_projects', t, 'CPR'\)/);
    expect(seed).toMatch(/pg_temp\.pcbs_next\('pricing_rfqs', t, 'RFQ'\)/);
    expect(seed).toMatch(/'SQ-SMP-' \|\|/);
    expect(seed).toMatch(/'QT-SMP-' \|\|/);
    expect(seed).not.toMatch(/'(ACC|CON|SUP|OPP|EST|CPR)-\d{4}'/);
  });

  it("uses only values the check constraints allow", () => {
    const constants = read("src/lib/constants.ts");
    const stageBlock = constants.slice(constants.indexOf("export const DEFAULT_TENDER_STAGES"), constants.indexOf("];", constants.indexOf("export const DEFAULT_TENDER_STAGES")));
    const tenderStages = new Set([...stageBlock.matchAll(/value:\s*"([a-z_]+)"/g)].map((m) => m[1]));
    const used = [...seed.matchAll(/'(received|estimating|submitted|bid_no_bid|clarifications)',\s*'open'/g)].map((m) => m[1]);
    expect(used.sort()).toEqual(["estimating", "received", "submitted"]);
    for (const s of used) expect(tenderStages.has(s), s).toBe(true);
    for (const p of seed.matchAll(/'(ariba|email|excel|other)',\s*(?:null|\d)/g)) expect(["ariba", "email", "excel", "other"]).toContain(p[1]);
    for (const m of seed.matchAll(/'(lower|similar|higher)'/g)) expect(["lower", "similar", "higher"]).toContain(m[1]);
    const accTypes = [...seed.matchAll(/^\s*\(\d+,\s*'SAMPLE [^']*',\s*'([a-z_]+)'/gm)].map((m) => m[1]);
    for (const ty of accTypes) expect(["prospect", "oem", "direct", "end_customer", "vendor", "subcontractor", "both", "lower", "similar", "higher"]).toContain(ty);
    const sqStatus = [...seed.slice(seed.indexOf("do $sq$"), seed.indexOf("do $quotations$")).matchAll(/^\s*\(\d,\s*\d+,\s*\d+,\s*'(draft|sent|accepted|rejected)',\s*'/gm)].map((m) => m[1]);
    expect(sqStatus).toEqual(["draft", "sent", "sent", "accepted", "accepted", "rejected"]);
    const rfqStatus = /'SAMPLE RFQ[^']*',\s*'([a-z_]+)'/.exec(seed)?.[1];
    expect(["draft", "sent", "partially_replied", "replied", "awarded", "closed", "cancelled"]).toContain(rfqStatus);
    for (const st of ["replied", "sent"]) expect(["pending", "sent", "viewed", "replied", "declined", "expired", "cancelled"]).toContain(st);
    expect(seed).toMatch(/'standard_quote'/);
  });
});

describe("the seed script: the promised sample set", () => {
  const count = (re: RegExp) => [...seed.matchAll(re)].length;

  it("10 accounts (6 customers, 4 prospects), 15 contacts with roles, 8 suppliers with categories", () => {
    const acc = [...seed.matchAll(/^\s*\((\d+),\s*'(SAMPLE [^']*)',\s*'([a-z_]+)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)',/gm)];
    expect(acc).toHaveLength(10);
    expect(acc.filter((a) => a[3] === "prospect")).toHaveLength(4);
    expect(acc.filter((a) => a[3] !== "prospect")).toHaveLength(6);
    for (const a of acc) expect(a[4].length, a[2]).toBeGreaterThan(2);
    expect(seed).toMatch(/'Saudi Arabia'/);
    const con = [...seed.matchAll(/^\s*\((\d+),\s*(\d+),\s*'(SAMPLE [^']*)',\s*'([^']*)',\s*'([^']*)'\)/gm)];
    expect(con).toHaveLength(15);
    const roles = con.map((c) => c[4]).join("|");
    expect(roles).toMatch(/Procurement/);
    expect(roles).toMatch(/Project Manager/);
    expect(roles).toMatch(/Engineer/);
    const sup = [...seed.matchAll(/^\s*\((\d+),\s*'(SAMPLE [^']*)',\s*'(vendor|subcontractor|both)',\s*'([^']*)',\s*'([^']*)',\s*'(Category: [^']*)'\)/gm)];
    expect(sup).toHaveLength(8);
    const cats = sup.map((s) => s[6].toLowerCase()).join("|");
    for (const w of ["cement", "reinforcement", "admixtures", "moulds", "lifting inserts", "hollow-core", "transport", "erection"]) expect(cats, w).toContain(w);
  });

  it("8 deals: 3 tender deals with 12, 14 and 10 BOQ lines, 4 led by a Standard Quote, 1 early enquiry", () => {
    expect(count(/'SAMPLE Tender [A-Z]+-2026-\d{3} - /g)).toBe(3);
    const boq = stripComments(rawSeed.slice(rawSeed.indexOf("-- The BOQ lines of the three tenders"), rawSeed.indexOf(") as v(deal")));
    const lines = [...boq.matchAll(/^\s*\(([123]),\s*(\d+),\s*'([^']*)',\s*'([^']*)',\s*([\d.]+),\s*([\d.]+)\),?$/gm)];
    const per = (d: string) => lines.filter((l) => l[1] === d).length;
    expect([per("1"), per("2"), per("3")]).toEqual([12, 14, 10]);
    for (const l of lines) expect(l[3].startsWith("SAMPLE "), l[3]).toBe(false);
    const others = stripComments(rawSeed.slice(rawSeed.indexOf("The five other deals"), rawSeed.indexOf("as v(n, nm, acc, con, stg, outc, prob, close_days, created_ago, closed_ago")));
    const titles = [...others.matchAll(/^\s*\(([4-8]),\s*'(SAMPLE [^']*)',/gm)].map((m) => m[2]);
    expect(titles).toHaveLength(5);
    const withQuote = [...seed.matchAll(/^\s*\(\d,\s*\d+,\s*\d+,\s*'(?:draft|sent|accepted|rejected)',[^\n]*,\s*(\d+|null::int),\s*(?:'opportunity'|'estimate'|null::text),/gm)];
    expect(withQuote.filter((m) => m[1] !== "null::int").length).toBeGreaterThanOrEqual(2);
    expect(seed).toMatch(/'NPW-2026-118'/);
    expect(seed).toMatch(/'(?:ariba|email|excel|other)', (?:null::numeric|\d+)/);
  });

  it("one tender has an RFQ to two suppliers with one reply; one has bid versions v1 and v2 with a reason for v2", () => {
    expect(seed).toMatch(/'SAMPLE RFQ - [^']*'/);
    expect(count(/insert into rfq_suppliers/g)).toBe(1);
    expect(seed).toMatch(/'replied', now\(\) - interval '6 days'[^;]*\(pg_temp\.pcbs_id\(14, 2\)[^;]*'sent'/);
    expect(seed).toMatch(/\(1, 25, null::text\), \(2, 11, '[^']{20,}'\)/);
    expect(seed).toMatch(/r\.vn = 1 and l\.sl_no::int <= 4 then round\(l\.rate \* 1\.05, 2\)/);
  });

  it("6 Standard Quotes (draft, 2 sent, 2 accepted from estimates, 1 rejected), 2 Quotations", () => {
    expect(seed).toMatch(/\(4, 1,\s+2, 'accepted',[^\n]*'estimate',\s+1\)/);
    expect(seed).toMatch(/\(5, 2,\s+3, 'accepted',[^\n]*'estimate',\s+2\)/);
    expect(seed).toMatch(/update estimates set standard_quote_id = pg_temp\.pcbs_id\(16, 4\), status = 'quoted'/);
    expect(seed).toMatch(/update estimates set standard_quote_id = pg_temp\.pcbs_id\(16, 5\), status = 'quoted'/);
    expect(count(/^\s*\((\d),\s*(\d),\s*(\d),\s*'(?:sent|draft)',\s*'SAMPLE /gm)).toBe(2);
    expect(seed).toMatch(/'Precast foundation 1000 x 1000 x 1200',\s+'Nos',\s+160/);
  });

  it("one contract project from the accepted estimate quote: budget lines, baseline revision in Draft, two-building WBS; the other accepted quote has none", () => {
    expect(seed).toMatch(/'standard_quote', pg_temp\.pcbs_id\(16, 4\)/);
    expect(seed).not.toMatch(/'standard_quote', pg_temp\.pcbs_id\(16, 5\)/);
    expect(seed).toMatch(/project_budget_revisions[^;]*0, 'draft'/);
    expect(seed).toMatch(/'draft', v_value/);
    const wbs = [...seed.matchAll(/\(pg_temp\.pcbs_id\(24, (\d)\), t, pg_temp\.pcbs_id\(21, 1\), (null|pg_temp\.pcbs_id\(24, \d\)),\s+'([\d.]+)',\s+'([^']*)'/g)];
    expect(wbs).toHaveLength(6);
    expect(wbs.filter((w) => w[2] === "null").map((w) => w[4])).toEqual(["Building A", "Building B"]);
    expect(seed).toMatch(/allocated, client_rate, client_amount, source_line_id/);
    expect(seed).toMatch(/where l\.tenant_id = t and l\.standard_quote_id = pg_temp\.pcbs_id\(16, 4\)/);
  });

  it("contains no real company or person, no literal date, no INR, no e-mail except .example supplier addresses, and no phone", () => {
    const text = rawSeed.toLowerCase();
    for (const real of [
      "aramco", "sabic", "almarai", "binladin", "bin laden", "nesma", "al rajhi", "alrajhi", "maaden", "savola", "jarir", "roshn", "neom", "qiddiya", "diriyah",
      "lafarge", "holcim", "cemex", "bechtel", "hochtief", "skanska", "vinci", "besix", "larsen", "stc", "mobily", "kamco", "vikas", "bigblue", "big blue", "bim infotech",
    ]) {
      expect(new RegExp(`\\b${real}\\b`).test(text), real).toBe(false);
    }
    expect(seed).not.toMatch(/'(?:19|20)\d\d-\d\d-\d\d/);
    expect(seed).not.toMatch(/'INR'|'USD'|'EUR'/);
    for (const e of rawSeed.matchAll(/[a-z0-9._-]+@[a-z0-9.-]+/gi)) expect(e[0], e[0]).toMatch(/\.example$/);
    const supplierEmails = [...rawSeed.matchAll(/'([a-z0-9._-]+@[a-z0-9.-]+\.example)'/g)];
    expect(supplierEmails).toHaveLength(8);
    for (const i of all.filter((x) => ["accounts", "contacts"].includes(x.table))) {
      for (const c of i.cols) expect(c, `${i.table}.${c}`).not.toMatch(/email|phone|gstin|vat_number|crn|password|address|id_number/);
    }
    expect(seed).toMatch(/coalesce\(nullif\(config->>'currency', ''\), 'SAR'\)/);
    expect(seed).toMatch(/now\(\)|current_date/);
  });

  it("every named record starts with 'SAMPLE ' (names, titles, projects, estimates, templates, RFQ)", () => {
    for (const i of all.filter((x) => ["accounts", "contacts", "suppliers", "opportunities", "rfqs", "contract_projects", "estimate_templates", "estimates", "opportunity_competitors"].includes(x.table))) {
      const open = i.stmt.search(/\bvalues\s*\(/i);
      if (open < 0) continue;
      const items = splitTop(balanced(i.stmt, i.stmt.indexOf("(", open)));
      if (items.length !== i.cols.length) continue;
      i.cols.forEach((c, k) => {
        if (!["name", "title"].includes(c)) return;
        if (items[k].startsWith("'")) expect(items[k].startsWith("'SAMPLE "), `${i.table}.${c} = ${items[k]}`).toBe(true);
      });
    }
    const gen = generate();
    expect(gen.summary.filter((s) => /^SAMPLE /.test(s))).toHaveLength(3);
  });
});

describe("the generated regions follow the engine (nothing hand-edited)", () => {
  it("the estimates and the quote lines in the seed are exactly what the generator writes now", () => {
    const g = generate();
    const region = (tag: string) => new RegExp(`-- BEGIN GENERATED ${tag}[^\\n]*\\n([\\s\\S]*?)\\n-- END GENERATED ${tag}`).exec(rawSeed)?.[1];
    expect(region("ESTIMATES")).toBe(g.estimates);
    expect(region("QUOTE LINES")).toBe(g.quoteLines);
  });

  it("the two accepted quotes name their lines exactly as the estimate's groups, so Fill from estimate costs matches every line", () => {
    const g = generate();
    for (const q of [4, 5]) {
      const lines = [...g.quoteLines.matchAll(new RegExp(`^\\s*\\(${q}, \\d+, '([^']*)'`, "gm"))].map((m) => m[1]);
      expect(lines.length).toBeGreaterThanOrEqual(6);
      const est = g.estimates;
      for (const name of lines) expect(est, name).toContain(`"group":"${name}"`);
    }
    expect(g.quoteLines).toMatch(/'Nos', 400,/);
    expect(g.quoteLines).toMatch(/'Precast foundation 1000 x 1000 x 1200'/);
  });

  it("no estimate line is tied to a product", () => {
    const g = generate();
    expect(g.estimates).not.toMatch(/product/i);
    expect(g.estimates).not.toMatch(/\bsku\b/i);
  });
});

describe("the cleanup script", () => {
  const arrays = [...cleanup.matchAll(/array\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  const order = [...arrays[0], "opportunity_tenders", "approval_requests", ...arrays[1]];

  it("finds the workspace by slug pcbs, does nothing without it and never changes the workspace", () => {
    expect(cleanup).toMatch(/from\s+tenants\s+where\s+slug\s*=\s*'pcbs'/i);
    expect(cleanup).toMatch(/if t is null then\s+raise notice '[^']*';\s+return;/);
    expect(cleanup).not.toMatch(/(?:delete\s+from|update|insert\s+into)\s+tenants\b/i);
    expect(cleanup).not.toMatch(/truncate|drop\s+(table|schema|column)|delete\s+from\s+\w+\s*;/i);
  });

  it("is a dry run until the owner changes one line", () => {
    expect(cleanup).toMatch(/v_confirm constant boolean := false;/);
    const body = cleanup.slice(cleanup.indexOf("begin\n  select id into t"));
    for (const d of body.matchAll(/delete\s+from\s+/gi)) {
      const before = body.slice(0, d.index);
      expect(before.lastIndexOf("if v_confirm"), "a delete is not behind v_confirm").toBeGreaterThan(before.lastIndexOf("end if;"));
    }
  });

  it("deletes only rows of the workspace whose id is in the reserved range", () => {
    expect(cleanup).toContain(`'${MARKER}%'`);
    const deletes = [...cleanup.matchAll(/delete\s+from\s+(%I|[a-z_]+)\s+where[^;]*/gi)].map((m) => m[0]);
    expect(deletes).toHaveLength(4);
    for (const d of deletes) {
      expect(d, d).toMatch(/tenant_id\s*=\s*(?:\$1|t)\b/);
      expect(d, d).toMatch(/(?:id|opportunity_id|object_id)::text\s+like\s+(?:\$2|v_pat)/);
    }
    expect(cleanup).not.toMatch(/\bname\s+like|\btitle\s+like/i);
    expect(cleanup).toMatch(/foreign_key_violation or restrict_violation/);
  });

  it("reaches every table the seed fills, children before parents, and no product", () => {
    for (const t of filled) expect(order, `${t} is not deleted by the cleanup`).toContain(t);
    for (const t of order) expect(tableColumns.has(t), t).toBe(true);
    expect(order).not.toContain("products");
    for (const t of filled) {
      const body = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${t}\\s*\\(`, "i").exec(migrationText);
      if (!body) continue;
      const text = balanced(migrationText, body.index + body[0].length - 1);
      for (const ref of text.matchAll(/references\s+([a-z_]+)\s*\(id\)/gi)) {
        const parent = ref[1];
        if (parent === t || !filled.has(parent)) continue;
        expect(order.indexOf(t), `${t} must be deleted before ${parent}`).toBeLessThan(order.indexOf(parent));
      }
    }
  });
});

describe("plpgsql name clashes", () => {
  it("never uses the loop variable name r, or the record x, as a table alias", () => {
    expect(seed).not.toMatch(/\b(?:from|join)\s+[a-z_]+\s+(?:r|x)\b/i);
    expect(cleanup).not.toMatch(/\b(?:from|join)\s+[a-z_]+\s+(?:r|x)\b/i);
  });
});
