import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// scripts/seed-kamco-test-data.sql and its cleanup are run by hand on the dedicated KAMCO project. They write real rows, so this file
// pins the rules that keep them safe: only the 'kamco' workspace (never a demo one), every row tagged TEST, every insert carrying
// tenant_id, only tables and columns the migrations really create, optional tables guarded, and a cleanup that can only reach the
// seed's own rows. (The scripts were also run against all migrations 0000-0229 in a real Postgres, twice, then cleaned up.)

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

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

/** The statement that starts at `from`, up to the next `;` outside a string literal (the `;` is not included). */
function statementFrom(code: string, from: number): string {
  let inStr = false;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (c === "'") inStr = !inStr;
    else if (c === ";" && !inStr) return code.slice(from, i);
  }
  return code.slice(from);
}

/** Splits on commas that are outside parentheses and string literals. */
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

/** The text inside the parentheses that open at `open` (index of the "("). */
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

const seed = stripComments(read("scripts/seed-kamco-test-data.sql"));
const cleanup = stripComments(read("scripts/seed-kamco-test-data-cleanup.sql"));
const isTemp = (tbl: string) => tbl.startsWith("kamco_");

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

describe("the seed script: whose workspace it writes to", () => {
  it("finds the workspace by the slug kamco, and every read of tenants says so", () => {
    expect(seed).toMatch(/from\s+tenants\s+where\s+slug\s*=\s*'kamco'/i);
    const reads = [...seed.matchAll(/from\s+tenants\b[^;]*/gi)].map((m) => m[0]);
    expect(reads).toHaveLength(2);
    for (const r of reads) expect(r, r).toMatch(/where\s+slug\s*=\s*'kamco'/i);
    expect(seed).toMatch(/No workspace with slug kamco was found/);
  });

  it("never selects, filters or loops over demo workspaces: a demo flag only makes it refuse", () => {
    expect(seed).not.toMatch(/is_demo\s*=\s*true/i);
    expect(seed).not.toMatch(/where[^;]*\bis_demo\b/i);
    expect(seed).not.toMatch(/for\s+\w+\s+in\s+select[^;]*from\s+tenants/i);
    expect(seed).toMatch(/if v_demo then\s+raise exception/);
  });

  it("only updates tenants by id (the feature flags), and only the features column", () => {
    const updates = [...seed.matchAll(/update\s+tenants\b[^;]*/gi)].map((m) => m[0]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatch(/set\s+features\s*=/i);
    expect(updates[0]).toMatch(/where\s+id\s*=\s*t\b/i);
    expect(seed).not.toMatch(/insert\s+into\s+tenants\b|delete\s+from\s+tenants\b/i);
  });

  it("switches on only flags that exist in TenantFeatures, in its own block at the top", () => {
    const constants = read("src/lib/constants.ts");
    const typeStart = constants.indexOf("export type TenantFeatures = {");
    const typeBody = constants.slice(typeStart, constants.indexOf("\n};", typeStart));
    const known = new Set([...typeBody.matchAll(/^\s{2}([a-z_0-9]+):\s*boolean;/gm)].map((m) => m[1]));
    const json = /\|\|\s*'(\{[\s\S]*?\})'::jsonb/.exec(seed);
    expect(json).not.toBeNull();
    const flags = JSON.parse(json![1]) as Record<string, unknown>;
    for (const [k, v] of Object.entries(flags)) {
      expect(known.has(k), `${k} is not a TenantFeatures key`).toBe(true);
      expect(v).toBe(true);
    }
    for (const needed of ["gcc_tender", "deal_room", "contract_projects", "pipeline", "rfq", "estimator", "suppliers", "products", "inbox"]) {
      expect(flags[needed], needed).toBe(true);
    }
    const raw = read("scripts/seed-kamco-test-data.sql");
    expect(raw.indexOf("BLOCK 1 of 2")).toBeGreaterThan(-1);
    expect(raw.indexOf("BLOCK 1 of 2")).toBeLessThan(raw.indexOf("BLOCK 2 of 2"));
    expect(raw.indexOf("do $flags$")).toBeLessThan(raw.indexOf("do $seed$"));
  });
});

describe("the seed script: every record is tagged TEST", () => {
  it("every values row that starts with a text literal starts with 'TEST '", () => {
    const rows = [...seed.matchAll(/^\s*\(\s*'([^']*)'/gm)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThanOrEqual(60);
    for (const r of rows) expect(r.startsWith("TEST "), `row starting with '${r}'`).toBe(true);
  });

  it("the constants that name the deals, the RFQ and the estimate start with 'TEST '", () => {
    const consts = [...seed.matchAll(/constant\s+text\s*:=\s*'([^']*)'/g)].map((m) => m[1]);
    expect(consts).toHaveLength(5);
    for (const c of consts) expect(c.startsWith("TEST "), c).toBe(true);
  });

  it("a name or title written as a literal in a single-row insert starts with 'TEST '", () => {
    for (const ins of inserts(seed).filter((i) => !isTemp(i.table) && i.cols.length)) {
      const open = ins.stmt.search(/\bvalues\s*\(/i);
      if (open < 0) continue;
      const items = splitTop(balanced(ins.stmt, ins.stmt.indexOf("(", open)));
      if (items.length !== ins.cols.length) continue;
      ins.cols.forEach((col, i) => {
        if (!["name", "title"].includes(col)) return;
        if (items[i].startsWith("'")) expect(items[i].startsWith("'TEST "), `${ins.table}.${col} = ${items[i]}`).toBe(true);
      });
    }
  });

  it("business numbers and SKUs typed in the script carry a TEST- prefix", () => {
    const tenderNos = [...seed.matchAll(/'(TEST-[A-Z]+-\d{4}-\d{3})'/g)].map((m) => m[1]);
    expect(tenderNos).toHaveLength(3);
    const skus = [...seed.matchAll(/^\s*\('TEST [^']*',\s*'([^']*)',\s*'(?:Pipes|Precast|Civil|Steel|Concrete|Valves)'/gm)].map((m) => m[1]);
    expect(skus.length).toBeGreaterThanOrEqual(15);
    for (const s of skus) expect(s.startsWith("TEST-"), s).toBe(true);
  });

  it("creates the promised amounts of the main records", () => {
    const count = (re: RegExp) => [...seed.matchAll(re)].length;
    expect(count(/\('TEST (?:Ministry|Municipality|National Water|Coastal)[^']*',\s*'(?:direct|prospect|end_customer)'\)/g)).toBe(4);
    expect(count(/\('TEST [^']*',\s*'vendor'\)/g)).toBe(5);
    expect(count(/\('TEST (?:Procurement|Project Engineer|Tender Secretary)[^']*'/g)).toBe(3);
  });
});

describe("the seed script: what it writes", () => {
  const all = inserts(seed).filter((i) => !isTemp(i.table));

  it("every insert names its columns and carries tenant_id", () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
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
  });

  it("every update and every lookup of a tenant-owned table is scoped to the workspace", () => {
    const updates = [...seed.matchAll(/update\s+([a-z_0-9]+)\s+set\b[^;]*/gi)].filter((m) => m[1] !== "tenants");
    expect(updates.length).toBeGreaterThanOrEqual(4);
    for (const u of updates) expect(u[0], u[0]).toMatch(/tenant_id\s*=\s*t\b/);
    // The columns an update sets exist too.
    for (const u of updates) {
      const cols = tableColumns.get(u[1])!;
      for (const s of u[0].matchAll(/\bset\s+([a-z_0-9]+)\s*=/gi)) expect(cols.has(s[1].toLowerCase()), `${u[1]}.${s[1]}`).toBe(true);
    }
  });

  it("writes no e-mail, phone, tax number, password or auth row", () => {
    for (const i of all.filter((x) => ["accounts", "contacts", "suppliers"].includes(x.table))) {
      for (const c of i.cols) expect(c, `${i.table}.${c}`).not.toMatch(/email|phone|gstin|vat_number|crn|password|address/);
    }
    expect(seed).not.toMatch(/auth\.users|\bpassword\b|crypt\(|tenant_users/i);
    // The one employee the owner asked for (2026-10-27) is the only e-mail the seed may carry.
    expect(seed.replace(/abdulkhader@saytara\.info/g, "")).not.toMatch(/@[a-z0-9-]+\.(com|org|net|sa|ae|qa|info)/i);
  });

  it("uses only values the check constraints allow (stage, outcome, portal, price source, price position, account type)", () => {
    const constants = read("src/lib/constants.ts");
    const stageBlock = constants.slice(constants.indexOf("export const DEFAULT_TENDER_STAGES"), constants.indexOf("];", constants.indexOf("export const DEFAULT_TENDER_STAGES")));
    const stages = new Set([...stageBlock.matchAll(/value:\s*"([a-z_]+)"/g)].map((m) => m[1]));
    const used = new Set([...seed.matchAll(/'([a-z_]+)',\s*'open'/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(["estimating", "received", "submitted"]);
    for (const s of used) expect(stages.has(s), s).toBe(true);

    const oneOf = (table: string, col: string) => {
      const m = new RegExp(`create\\s+table[^;]*?${table}[\\s\\S]*?${col}\\s+text[^,]*?check\\s*\\(\\s*${col}\\s+in\\s*\\(([^)]*)\\)`, "i").exec(migrationText);
      return new Set([...(m?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    };
    const portals = oneOf("opportunity_tenders", "portal");
    for (const p of seed.matchAll(/'(ariba|email|excel|other)'/g)) expect(portals.has(p[1]), p[1]).toBe(true);
    expect(portals.size).toBeGreaterThan(0);

    const sources = new Set(["boq_rate", "bom", "past_project", "supplier", "manual"]);
    for (const s of seed.matchAll(/^\s*\('TEST [^\n]*?'(boq_rate|bom|past_project|supplier|manual|estimate)'/gm)) expect(sources.has(s[1]), s[1]).toBe(true);

    for (const m of seed.matchAll(/\('TEST [^']*',\s*'(lower|similar|higher)'/g)) expect(["lower", "similar", "higher"]).toContain(m[1]);
    for (const m of seed.matchAll(/\('TEST (?:Ministry|Municipality|National Water|Coastal)[^']*',\s*'([a-z_]+)'\)/g)) {
      expect(["prospect", "oem", "direct", "end_customer"]).toContain(m[1]);
    }
  });

  it("guards every optional table with to_regclass, and stops with a clear message when a required one is missing", () => {
    for (const t of [
      "inventory_items", "tender_boq_sources", "tender_boq_lines", "estimates", "estimate_lines", "rfqs", "rfq_lines", "rfq_suppliers",
      "rfq_responses", "tender_bid_versions", "opportunity_competitors", "deal_activities",
    ]) {
      expect(seed, t).toContain(`to_regclass('public.${t}')`);
    }
    expect(seed).toMatch(/to_regclass\('public\.opportunity_tenders'\) is null then\s+raise exception 'Run migration 0220/);
    expect(seed).toMatch(/information_schema\.columns[^;]*column_name = 'opportunity_id'/);
  });

  it("is idempotent: each record kind is looked up by its TEST name before it is created", () => {
    expect(seed).toMatch(/select id into opp1 from opportunities where tenant_id = t and title = c_opp1;\s+if opp1 is null then/);
    expect(seed).toMatch(/select id, ref into opp2, opp2_ref from opportunities where tenant_id = t and title = c_opp2;\s+if opp2 is null then/);
    expect(seed).toMatch(/select id into opp3 from opportunities where tenant_id = t and title = c_opp3;\s+if opp3 is null then/);
    expect(seed).toMatch(/select id into est_id from estimates where tenant_id = t and name = c_est;\s+if est_id is null then/);
    expect(seed).toMatch(/select id into rfq_id_v from rfqs where tenant_id = t and title = c_rfq;\s+if rfq_id_v is null then/);
    expect((seed.match(/if not exists \(select 1 from/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(seed).not.toMatch(/on conflict[^;]*do update/i);
  });

  it("makes refs the way the app does: the next free number for the workspace, never a fixed one", () => {
    expect(seed).toMatch(/pg_temp\.kamco_ref\('accounts', t, 'ACC'\)/);
    expect(seed).toMatch(/pg_temp\.kamco_ref\('opportunities', t, 'OPP'\)/);
    expect(seed).toMatch(/pg_temp\.kamco_ref\('products', t, 'PRD'\)/);
    expect(seed).toMatch(/pg_temp\.kamco_next\('pricing_rfqs', t, 'RFQ'\)/);
    expect(seed).not.toMatch(/'(ACC|CON|SUP|PRD|INV|OPP|EST)-\d{4}'/);
  });

  it("does not write a cost or a markup into the saved bid snapshot", () => {
    const bid = seed.slice(seed.indexOf("insert into tender_bid_versions"), seed.indexOf("opportunity_competitors", seed.indexOf("insert into tender_bid_versions")));
    expect(bid).not.toMatch(/unit_cost|markup|cost_price|margin/);
  });
});

describe("the cleanup script", () => {
  const deletes = [...cleanup.matchAll(/delete\s+from\s+([a-z_0-9]+)\b[^;]*/gi)].map((m) => ({ table: m[1], stmt: m[0] }));

  it("finds the workspace by slug kamco and refuses a demo workspace", () => {
    expect(cleanup).toMatch(/from\s+tenants\s+where\s+slug\s*=\s*'kamco'/i);
    expect(cleanup).not.toMatch(/is_demo\s*=\s*true/i);
    expect(cleanup).toMatch(/if v_demo then\s+raise exception/);
    expect(cleanup).toMatch(/No workspace with slug kamco was found/);
    expect(cleanup).not.toMatch(/\bdelete\s+from\s+tenants\b|\bupdate\s+tenants\b/i);
  });

  it("is a dry run until the owner changes one line", () => {
    expect(cleanup).toMatch(/v_confirm constant boolean := false;/);
    const doBody = cleanup.slice(cleanup.indexOf("begin"));
    for (const d of deletes) {
      const before = doBody.slice(0, doBody.indexOf(d.stmt));
      const lastIf = before.lastIndexOf("if v_confirm then");
      const lastEnd = before.lastIndexOf("end if;");
      expect(lastIf, `delete from ${d.table} is not behind v_confirm`).toBeGreaterThan(lastEnd);
    }
  });

  it("deletes only by workspace and TEST name, or by the ids of the TEST deals it found", () => {
    expect(deletes.length).toBeGreaterThanOrEqual(8);
    for (const d of deletes) {
      expect(d.stmt, d.stmt).toMatch(/where\s+tenant_id\s*=\s*t\b/);
      expect(d.stmt, d.stmt).toMatch(/(?:name|title|first_name)\s+like\s+'TEST %'|(?:object_id|id)\s*=\s*any\(v_opps\)/);
    }
    expect(cleanup).toMatch(/v_opps[^;]*from opportunities where tenant_id = t and title like 'TEST %'/);
    expect(cleanup).not.toMatch(/truncate|drop\s+(table|schema|column)|delete\s+from\s+\w+\s*;/i);
  });

  it("deletes from tables that exist, and reaches every table the seed fills (directly or by cascade)", () => {
    const deleted = new Set(deletes.map((d) => d.table));
    for (const t of deleted) expect(tableColumns.has(t), t).toBe(true);

    // Children the seed fills that go with their parent: each one's foreign key to that parent must say on delete cascade.
    const CASCADE: Record<string, string[]> = {
      opportunity_tenders: ["opportunities"], opportunity_lines: ["opportunities"], tender_boq_sources: ["opportunities"],
      tender_boq_lines: ["opportunities"], tender_bid_versions: ["opportunities"], opportunity_competitors: ["opportunities"],
      deal_activities: ["opportunities"], estimate_lines: ["estimates"], rfq_lines: ["rfqs"], rfq_suppliers: ["rfqs"],
      rfq_responses: ["rfq_suppliers", "rfq_lines"],
    };
    const tablesFilled = new Set(inserts(seed).filter((i) => !isTemp(i.table)).map((i) => i.table));
    for (const t of tablesFilled) {
      if (deleted.has(t)) continue;
      const parents = CASCADE[t];
      expect(parents, `${t} is filled by the seed but neither deleted nor cascaded by the cleanup`).toBeDefined();
      const body = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${t}\\s*\\(`, "i").exec(migrationText);
      const text = balanced(migrationText, body!.index + body![0].length - 1);
      for (const p of parents) expect(text, `${t} -> ${p}`).toMatch(new RegExp(`references\\s+${p}\\s*\\(id\\)\\s+on\\s+delete\\s+cascade`, "i"));
    }
  });
});

describe("the ledger", () => {
  it("PROJECT.md lists both scripts as KAMCO-only test data, with the cleanup for later", () => {
    const project = read("PROJECT.md");
    expect(project).toMatch(/KAMCO test data, run on KAMCO only, cleanup later/);
    expect(project).toContain("scripts/seed-kamco-test-data.sql");
    expect(project).toContain("scripts/seed-kamco-test-data-cleanup.sql");
  });
});
