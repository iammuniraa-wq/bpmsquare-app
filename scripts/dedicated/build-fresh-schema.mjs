// Builds one SQL file that creates a BPMSquare database from nothing, and checks that it can.
//
//   node scripts/dedicated/build-fresh-schema.mjs [--migrations supabase/migrations]
//        [--out dist/dedicated/fresh-schema.sql] [--report dist/dedicated/fresh-schema-report.md]
//        [--app-src src] [--keep-baseline-seeds] [--include-client-data] [--strict]
//
// What it does (no database connection, no npm packages):
//   1. Orders the files: 0000_baseline.sql first, then 0030+ in numeric order.
//   2. Neutralises the baseline's tenant-specific seed rows (owner e-mail as platform admin, the "vikas" tenant)
//      unless --keep-baseline-seeds, and leaves out pure client-data migrations unless --include-client-data.
//   3. Writes the concatenation with a header (file order, per-file hash, overall hash).
//   4. Replays the files in a small SQL reader and flags anything that cannot run on a clean database:
//      statements on tables/columns that nothing created before them, missing extensions, tenant-specific data.
//   5. With --app-src, also lists tables, RPC functions and storage buckets the application uses that no
//      migration creates (the symptom of production drift).
//
// Exit code: 0 when no ERROR findings, 1 otherwise (2 with --strict when there are warnings too).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------

/** Objects Supabase (hosted or the official self-hosted compose) provides before our SQL runs. */
export const PROVIDED_TABLES = new Set([
  "auth.users", "auth.identities", "auth.sessions", "storage.objects", "storage.buckets",
]);
/** Extensions that a plain `create extension` can add on Supabase. gen_random_uuid() is core since PG13. */
export const EXTENSION_FUNCTIONS = {
  pg_trgm: [/\bgin_trgm_ops\b/, /\bgist_trgm_ops\b/, /\bsimilarity\s*\(/, /\bword_similarity\s*\(/],
  "uuid-ossp": [/\buuid_generate_v[1-5]\s*\(/],
  pgcrypto: [/\bgen_salt\s*\(/, /\bcrypt\s*\(/, /\bdigest\s*\(/, /\bpgp_sym_/],
  unaccent: [/\bunaccent\s*\(/],
  citext: [/\bcitext\b/],
  vector: [/\bvector\s*\(\s*\d+\s*\)/],
  pg_cron: [/\bcron\.schedule\s*\(/],
  pg_net: [/\bnet\.http_/],
};

/** Migrations that are pure client data. Left out by default so one client's details never ship in another's database. */
export const CLIENT_DATA_MIGRATIONS = {
  "0031_copy_vikas_pioneers_entity_profile.sql":
    "one-off copy of a client's company profile (GSTIN, phones, address) into the 'vikas-pioneers' tenant; a no-op on any database without that tenant",
};

/** Statements in the baseline that create the owner's account and the original pilot tenant. */
export const BASELINE_SEED_PATTERNS = [
  { re: /insert\s+into\s+platform_admins\s*\(\s*email\s*\)\s*values\s*\(\s*'[^']+'\s*\)\s*;/i, what: "owner e-mail inserted as platform admin" },
  { re: /insert\s+into\s+tenants\s*\(\s*slug\s*,\s*name\s*,\s*accent_color\s*,\s*status\s*,\s*plan\s*,\s*features\s*\)\s*values\s*\(\s*'vikas'[\s\S]*?\}'::jsonb\s*\)\s*;/i, what: "pilot tenant 'vikas' (BPMSquare Demo) inserted" },
];

const SEVERITY = { ERROR: "ERROR", WARN: "WARN", INFO: "INFO" };

// ---------------------------------------------------------------------------------------------
// File ordering
// ---------------------------------------------------------------------------------------------

export function listMigrationFiles(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const num = (f) => {
    const m = /^(\d+)/.exec(f);
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
  };
  files.sort((a, b) => num(a) - num(b) || a.localeCompare(b));
  return files;
}

export function numberGaps(files) {
  const nums = files.map((f) => /^(\d+)/.exec(f)).filter(Boolean).map((m) => parseInt(m[1], 10));
  const seen = new Map();
  const dupes = [];
  for (const n of nums) {
    if (seen.has(n)) dupes.push(n);
    seen.set(n, true);
  }
  const gaps = [];
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  // 0001-0029 are the archived legacy files, replayed inside the baseline; gaps are only meaningful from 0030.
  for (let i = 1; i < sorted.length; i++) for (let n = sorted[i - 1] + 1; n < sorted[i]; n++) if (n >= 30) gaps.push(n);
  return { gaps, dupes };
}

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------------------------------------
// A small SQL reader: strips comments, splits statements, respects quotes and $$ bodies.
// ---------------------------------------------------------------------------------------------

/** @returns {{text:string,line:number}[]} statements with comments removed; `text` keeps dollar bodies intact. */
export function splitStatements(sql) {
  const out = [];
  let buf = "";
  let line = 1;
  let startLine = 1;
  let i = 0;
  const n = sql.length;
  const push = () => {
    const t = buf.trim();
    if (t) out.push({ text: t, line: startLine });
    buf = "";
  };
  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];
    if (!buf.trim() && c === "\n") startLine = line + 1;
    if (c === "-" && c2 === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "\n") { line++; buf += "\n"; }
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      const chunk = sql.slice(i, j + 1);
      for (const ch of chunk) if (ch === "\n") line++;
      if (!buf.trim()) startLine = line - (chunk.split("\n").length - 1);
      buf += chunk;
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && sql[j] !== '"') j++;
      buf += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_]\w*)?\$/.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        const chunk = sql.slice(i, stop);
        for (const ch of chunk) if (ch === "\n") line++;
        if (!buf.trim()) startLine = line - (chunk.split("\n").length - 1);
        buf += chunk;
        i = stop;
        continue;
      }
    }
    if (c === ";") {
      push();
      i++;
      continue;
    }
    if (c === "\n") line++;
    if (!buf.trim() && c.trim()) startLine = line;
    buf += c;
    i++;
  }
  push();
  return out;
}

/** Lower-cased statement with string literals and dollar bodies blanked, for keyword matching. */
export function skeleton(text) {
  return text
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, "$$$$")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][\w$]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;

export function normName(raw) {
  const parts = raw.split(".").map((p) => p.trim().replace(/^"|"$/g, "").toLowerCase());
  if (parts.length === 2 && parts[0] === "public") return parts[1];
  return parts.join(".");
}

function topLevelSplit(s, sepRe = ",") {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function parenBody(s, from) {
  const open = s.indexOf("(", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    if (s[i] === ")") { depth--; if (depth === 0) return { body: s.slice(open + 1, i), end: i }; }
  }
  return null;
}

const CONSTRAINT_START = /^(constraint|primary|unique|check|foreign|exclude|like)\b/;

// ---------------------------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------------------------

/**
 * @param {{name:string, sql:string}[]} files in execution order
 * @param {{providedTables?:Set<string>}} [opts]
 */
export function analyze(files, opts = {}) {
  const provided = opts.providedTables ?? PROVIDED_TABLES;
  /** @type {{severity:string,file:string,line:number,code:string,message:string}[]} */
  const findings = [];
  const tables = new Map(); // name -> {cols:Set<string>|null, createdIn}
  const views = new Set();
  const functions = new Set();
  const types = new Set();
  const extensions = new Map(); // name -> file
  const buckets = new Map(); // id -> {file, public}
  const policies = [];
  const policyNames = new Set(); // "table|name"
  const constraints = new Set(); // "table|name"
  const tenantSeeds = [];
  const note = (severity, file, line, code, message) => findings.push({ severity, file, line, code, message });

  for (const t of provided) tables.set(t, { cols: null, createdIn: "(provided by Supabase)" });

  const exists = (name) => tables.has(name) || views.has(name);
  const requireTable = (name, file, line, why, guarded) => {
    if (name.startsWith("pg_temp.") || name.startsWith("pg_catalog.") || name.startsWith("information_schema.")) return false;
    if (exists(name)) return true;
    if (name.includes(".") && !provided.has(name)) {
      note(guarded ? SEVERITY.INFO : SEVERITY.WARN, file, line, "UNKNOWN_SCHEMA", `${why} "${name}" in a schema this kit does not know to be provided`);
      return false;
    }
    note(guarded ? SEVERITY.INFO : SEVERITY.ERROR, file, line, guarded ? "GUARDED_MISSING_TABLE" : "MISSING_TABLE",
      `${why} "${name}", which no earlier statement creates${guarded ? " (inside a DO block, so it may be guarded)" : ""}`);
    return false;
  };
  const addColumn = (table, col) => {
    const t = tables.get(table);
    if (t && t.cols) t.cols.add(col);
  };
  const hasColumn = (table, col) => {
    const t = tables.get(table);
    if (!t || !t.cols) return true; // unknown column set: do not guess
    return t.cols.has(col);
  };
  const requireColumn = (table, col, file, line, why, guarded) => {
    if (!exists(table) || !tables.has(table)) return;
    if (/^(oid|ctid|xmin|xmax|tableoid)$/.test(col)) return;
    if (!hasColumn(table, col)) {
      note(guarded ? SEVERITY.INFO : SEVERITY.ERROR, file, line, "MISSING_COLUMN", `${why} column "${table}.${col}", which no earlier statement creates`);
    }
  };

  const handle = (stmt, file, guarded) => {
    const sk = skeleton(stmt.text);
    const line = stmt.line;
    let m;

    if ((m = new RegExp(String.raw`^create extension (?:if not exists )?(${IDENT})`).exec(sk))) {
      extensions.set(m[1].replace(/"/g, ""), file);
      return;
    }
    // extension-dependent syntax
    for (const [ext, res] of Object.entries(EXTENSION_FUNCTIONS)) {
      if (!extensions.has(ext) && res.some((r) => r.test(sk)) && !/^create extension/.test(sk)) {
        if (ext === "pgcrypto") continue; // created in the baseline; digest()/crypt() only used after it
        note(SEVERITY.ERROR, file, line, "MISSING_EXTENSION", `uses ${ext} syntax before "create extension ${ext}" has run`);
        extensions.set(ext, "(reported)");
      }
    }

    if ((m = new RegExp(String.raw`^create (?:unlogged |temp |temporary )?table (?:if not exists )?(${QNAME})`).exec(sk))) {
      const name = normName(m[1]);
      if (name.startsWith("pg_temp.")) return;
      const fromText = stmt.text.replace(/\s+/g, " ");
      const body = parenBody(skeleton(stmt.text).length ? sk : sk, sk.indexOf(m[1]) + m[1].length);
      const already = tables.has(name);
      const cols = new Set();
      let opaque = /^create (?:unlogged |temp |temporary )?table (?:if not exists )?\S+ as\b/.test(sk);
      if (body) {
        for (const item of topLevelSplit(body.body)) {
          const it = item.trim();
          if (!it) continue;
          if (/^like\b/.test(it)) { opaque = true; continue; }
          if (CONSTRAINT_START.test(it)) {
            const cn = new RegExp(String.raw`^constraint (${IDENT})`).exec(it);
            if (cn) constraints.add(`${name}|${cn[1].replace(/"/g, "")}`);
            const r = new RegExp(String.raw`references (${QNAME})`).exec(it);
            if (r) requireTable(normName(r[1]), file, line, `foreign key in "${name}" references`, guarded) || null;
            continue;
          }
          const c = new RegExp(String.raw`^(${IDENT})`).exec(it);
          if (c) cols.add(c[1].replace(/"/g, ""));
          if (c && /\bcheck\s*\(/.test(it)) constraints.add(`${name}|${name}_${c[1].replace(/"/g, "")}_check`);
          const r = new RegExp(String.raw`references (${QNAME})`).exec(it);
          if (r) {
            const rn = normName(r[1]);
            if (rn !== name) requireTable(rn, file, line, `column "${c?.[1]}" of "${name}" references`, guarded);
          }
        }
      }
      void fromText;
      if (!already) tables.set(name, { cols: opaque ? null : cols, createdIn: file });
      else if (!/if not exists/.test(sk)) note(SEVERITY.ERROR, file, line, "DUPLICATE_TABLE", `table "${name}" is created twice without "if not exists"`);
      return;
    }
    if ((m = new RegExp(String.raw`^create (?:or replace )?(?:materialized )?view (${QNAME})`).exec(sk))) {
      views.add(normName(m[1]));
      return;
    }
    if ((m = new RegExp(String.raw`^create (?:or replace )?function (${QNAME})`).exec(sk))) {
      functions.add(normName(m[1]).replace(/^pg_temp\./, ""));
      return;
    }
    if ((m = new RegExp(String.raw`^create type (${QNAME})`).exec(sk))) {
      types.add(normName(m[1]));
      return;
    }
    if ((m = new RegExp(String.raw`^create (?:unique )?index (?:concurrently )?(?:if not exists )?(?:${IDENT} )?on (?:only )?(${QNAME})`).exec(sk))) {
      const t = normName(m[1]);
      if (requireTable(t, file, line, "index on", guarded)) {
        const b = parenBody(sk, sk.indexOf(" on ") + 4 + m[1].length);
        if (b) {
          for (const part of topLevelSplit(b.body)) {
            const cm = new RegExp(String.raw`^\s*(${IDENT})\s*(?:$|asc|desc|nulls|gin_trgm_ops|gist_trgm_ops|text_pattern_ops|varchar_pattern_ops|jsonb_path_ops)`).exec(part);
            if (cm) requireColumn(t, cm[1].replace(/"/g, ""), file, line, "index on", guarded);
          }
        }
      }
      return;
    }
    if ((m = new RegExp(String.raw`^create policy ("[^"]*"|\S+) on (${QNAME})`).exec(sk))) {
      const t = normName(m[2]);
      requireTable(t, file, line, "policy on", guarded);
      policyNames.add(`${t}|${m[1].replace(/"/g, "")}`);
      policies.push({ table: t, file, line });
      return;
    }
    if ((m = new RegExp(String.raw`^drop policy (if exists )?("[^"]*"|\S+) on (${QNAME})`).exec(sk))) {
      const t = normName(m[3]);
      const key = `${t}|${m[2].replace(/"/g, "")}`;
      if (!m[1] && exists(t) && !policyNames.has(key)) {
        note(guarded ? SEVERITY.INFO : SEVERITY.ERROR, file, line, "DROP_MISSING_POLICY", `DROP POLICY ${m[2]} on "${t}" without "if exists", and no earlier statement creates that policy`);
      }
      policyNames.delete(key);
      return;
    }
    if ((m = new RegExp(String.raw`^create (?:or replace )?(?:constraint )?trigger \S+ .*? on (${QNAME})`).exec(sk))) {
      requireTable(normName(m[1]), file, line, "trigger on", guarded);
      return;
    }
    if ((m = new RegExp(String.raw`^alter table (if exists )?(?:only )?(${QNAME})`).exec(sk))) {
      const t = normName(m[2]);
      const ifExists = !!m[1];
      const present = ifExists ? exists(t) : requireTable(t, file, line, "ALTER TABLE on", guarded);
      if (!present && ifExists) return;
      if (!present) return;
      const rest = sk.slice(m[0].length).trim();
      if ((m = /^rename to (\S+)/.exec(rest))) {
        const to = normName(m[1]);
        const old = tables.get(t);
        tables.delete(t);
        tables.set(to, old ?? { cols: null, createdIn: file });
        return;
      }
      if ((m = new RegExp(String.raw`^rename (?:column )?(${IDENT}) to (${IDENT})`).exec(rest)) && !/^rename (?:constraint)/.test(rest)) {
        const from = m[1].replace(/"/g, "");
        requireColumn(t, from, file, line, "RENAME COLUMN on", guarded);
        const tt = tables.get(t);
        if (tt?.cols) { tt.cols.delete(from); tt.cols.add(m[2].replace(/"/g, "")); }
        return;
      }
      // Walk the comma-separated actions of the ALTER TABLE
      for (const act of topLevelSplit(rest)) {
        const a = act.trim();
        let am;
        if ((am = new RegExp(String.raw`^add (?:column )?(if not exists )?(${IDENT}) `).exec(a)) && !/^add (constraint|primary|unique|check|foreign)/.test(a)) {
          addColumn(t, am[2].replace(/"/g, ""));
          const r = new RegExp(String.raw`references (${QNAME})`).exec(a);
          if (r) requireTable(normName(r[1]), file, line, `column "${am[2]}" added to "${t}" references`, guarded);
        } else if ((am = new RegExp(String.raw`^add constraint (${IDENT})`).exec(a))) {
          constraints.add(`${t}|${am[1].replace(/"/g, "")}`);
          const r = new RegExp(String.raw`references (${QNAME})`).exec(a);
          if (r) requireTable(normName(r[1]), file, line, `constraint added to "${t}" references`, guarded);
        } else if ((am = new RegExp(String.raw`^drop constraint (if exists )?(${IDENT})`).exec(a))) {
          const key = `${t}|${am[2].replace(/"/g, "")}`;
          if (!am[1] && !constraints.has(key)) {
            note(SEVERITY.WARN, file, line, "DROP_UNKNOWN_CONSTRAINT", `DROP CONSTRAINT ${am[2]} on "${t}" without "if exists"; no earlier statement names it (it may be auto-named; check it exists on a clean build)`);
          }
          constraints.delete(key);
        } else if (/^add (constraint \S+ )?foreign key/.test(a)) {
          const r = new RegExp(String.raw`references (${QNAME})`).exec(a);
          if (r) requireTable(normName(r[1]), file, line, `foreign key added to "${t}" references`, guarded);
        } else if ((am = new RegExp(String.raw`^drop (?:column )?(if exists )?(${IDENT})`).exec(a)) && !/^drop (constraint|not null|default)/.test(a)) {
          const col = am[2].replace(/"/g, "");
          if (!am[1]) requireColumn(t, col, file, line, "DROP COLUMN on", guarded);
          const tt = tables.get(t);
          if (tt?.cols) tt.cols.delete(col);
        } else if ((am = new RegExp(String.raw`^alter (?:column )?(${IDENT}) `).exec(a))) {
          requireColumn(t, am[1].replace(/"/g, ""), file, line, "ALTER COLUMN on", guarded);
        }
      }
      return;
    }
    if ((m = new RegExp(String.raw`^drop table (if exists )?(${QNAME})`).exec(sk))) {
      const t = normName(m[2]);
      if (!m[1] && !tables.has(t)) note(guarded ? SEVERITY.INFO : SEVERITY.ERROR, file, line, "DROP_MISSING", `DROP TABLE "${t}" without "if exists" on a table nothing created`);
      tables.delete(t);
      return;
    }
    if ((m = new RegExp(String.raw`^insert into (${QNAME})\s*(\()?`).exec(sk))) {
      const t = normName(m[1]);
      if (t === "storage.buckets") {
        const idm = /values\s*\(\s*'([^']+)'[^)]*?(true|false)/i.exec(stmt.text.replace(/\s+/g, " "));
        if (idm) buckets.set(idm[1], { file, public: idm[2].toLowerCase() === "true" });
        return;
      }
      if (requireTable(t, file, line, "INSERT into", guarded) && m[2]) {
        const b = parenBody(sk, sk.indexOf(m[1]) + m[1].length);
        if (b) for (const c of topLevelSplit(b.body)) requireColumn(t, c.trim().replace(/"/g, ""), file, line, "INSERT into", guarded);
      }
      if (t === "platform_admins" || t === "tenants") tenantSeeds.push({ file, line, table: t, text: stmt.text.slice(0, 160).replace(/\s+/g, " ") });
      return;
    }
    if ((m = new RegExp(String.raw`^update (?:only )?(${QNAME})(?: (?:as )?\w+)? set`).exec(sk))) {
      const t = normName(m[1]);
      requireTable(t, file, line, "UPDATE on", guarded);
      if (t === "tenants" && /where [^;]*(?:slug|id) *(?:=|in) *\(?''/.test(sk)) {
        tenantSeeds.push({ file, line, table: t, text: stmt.text.slice(0, 160).replace(/\s+/g, " ") });
      }
      return;
    }
    if ((m = new RegExp(String.raw`^delete from (?:only )?(${QNAME})`).exec(sk))) {
      requireTable(normName(m[1]), file, line, "DELETE from", guarded);
      return;
    }
    if ((m = new RegExp(String.raw`^(?:grant|revoke) .*? on (?:table )?(${QNAME}) (?:to|from)`).exec(sk))) {
      const t = normName(m[1]);
      if (!/^(all|function|schema|sequence|all tables)/.test(t)) requireTable(t, file, line, "GRANT/REVOKE on", guarded);
      return;
    }
    if ((m = new RegExp(String.raw`^comment on table (${QNAME})`).exec(sk))) {
      requireTable(normName(m[1]), file, line, "COMMENT on", guarded);
      return;
    }
    if (/^do\b/.test(sk)) {
      // Statements inside DO blocks: read them as guarded. We only pick up what they create, so later
      // statements are not falsely reported, and list the references as INFO.
      const body = /\$([A-Za-z_]\w*)?\$([\s\S]*)\$\1\$/.exec(stmt.text);
      if (body) {
        const inner = body[2];
        for (const s of splitInner(inner)) handle({ text: s, line }, file, true);
      }
      return;
    }
  };

  for (const f of files) {
    for (const st of splitStatements(f.sql)) handle(st, f.name, false);
  }

  // Extension use inside function bodies / policies is late-bound, so only creation is checked above.
  return {
    findings,
    tables: [...tables.keys()].filter((t) => !provided.has(t)),
    columns: Object.fromEntries([...tables].filter(([k, v]) => !provided.has(k) && v.cols).map(([k, v]) => [k, [...v.cols]])),
    opaqueTables: [...tables].filter(([k, v]) => !provided.has(k) && !v.cols).map(([k]) => k),
    views: [...views],
    functions: [...functions],
    types: [...types],
    extensions: Object.fromEntries(extensions),
    buckets: Object.fromEntries(buckets),
    policies,
    tenantSeeds,
  };
}

/** Split the inside of a DO block on top-level semicolons (good enough to see its DDL/DML). */
function splitInner(body) {
  const stripped = splitStatements(body.replace(/\b(begin|end|exception|loop|then|else|elsif)\b/gi, " "));
  const out = [];
  for (const s of stripped) {
    const t = s.text.replace(/^[\s\S]*?\b(create|alter|insert|update|delete|drop|grant|revoke)\b/i, "$1");
    if (/^(create|alter|insert|update|delete|drop|grant|revoke)\b/i.test(t)) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Application cross-check
// ---------------------------------------------------------------------------------------------

function walk(dir, exts, acc = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next") continue;
    const p = path.join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, exts, acc);
    else if (exts.some((x) => p.endsWith(x)) && !/\.test\.tsx?$/.test(p)) acc.push(p);
  }
  return acc;
}

export function scanApp(srcDir, analysis) {
  const usedTables = new Map();
  const usedRpc = new Map();
  const usedBuckets = new Map();
  for (const f of walk(srcDir, [".ts", ".tsx"])) {
    const raw = readFileSync(f, "utf8");
    const text = raw.replace(/storage\s*\.from\(/g, "STORAGE_FROM(");
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
    for (const m of text.matchAll(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g)) {
      if (!usedTables.has(m[1])) usedTables.set(m[1], rel);
    }
    for (const m of text.matchAll(/\.rpc\(\s*["']([a-z_][a-z0-9_]*)["']/g)) if (!usedRpc.has(m[1])) usedRpc.set(m[1], rel);
    for (const m of text.matchAll(/STORAGE_FROM\(\s*["']([a-z0-9-]+)["']/g)) if (!usedBuckets.has(m[1])) usedBuckets.set(m[1], rel);
    for (const m of text.matchAll(/\b(?:[A-Z_]*BUCKET[A-Z_]*)\s*=\s*["']([a-z0-9-]+)["']/g)) if (!usedBuckets.has(m[1])) usedBuckets.set(m[1], rel);
  }
  const known = new Set([...analysis.tables, ...analysis.views]);
  return {
    missingTables: [...usedTables].filter(([t]) => !known.has(t)).map(([name, file]) => ({ name, file })),
    missingFunctions: [...usedRpc].filter(([f]) => !analysis.functions.includes(f)).map(([name, file]) => ({ name, file })),
    missingBuckets: [...usedBuckets].filter(([b]) => !(b in analysis.buckets)).map(([name, file]) => ({ name, file })),
    usedBuckets: [...usedBuckets].map(([name, file]) => ({ name, file })),
    columnHits: scanAppColumns(srcDir, analysis),
  };
}


/**
 * Heuristic: `.from("t") ... .select("a, b, c")` with plain column names, compared with the columns the migrations
 * give table t. Joins, aliases and casts are skipped. A hit means the code reads a column no migration adds, which is
 * what production drift looks like from the code side. Treat hits as leads to check, not proof.
 */
export function scanAppColumns(srcDir, analysis) {
  const hits = [];
  const seen = new Set();
  for (const f of walk(srcDir, [".ts", ".tsx"])) {
    const text = readFileSync(f, "utf8");
    const rel = path.relative(process.cwd(), f).replace(/\\/g, "/");
    for (const m of text.matchAll(/\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)\s*\.select\(\s*(["'`])([^"'`()]*)\2/g)) {
      const table = m[1];
      const cols = analysis.columns[table];
      if (!cols) continue;
      for (const raw of m[3].split(",")) {
        const col = raw.trim();
        if (!col || col === "*" || /[\s:!.${}]/.test(col)) continue;
        if (!cols.includes(col)) {
          const key = `${table}.${col}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({ table, column: col, file: rel });
        }
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

/**
 * @param {string} dir migrations directory
 * @param {{keepBaselineSeeds?:boolean, includeClientData?:boolean}} [opts]
 */
export function buildFresh(dir, opts = {}) {
  const names = listMigrationFiles(dir);
  const included = [];
  const skipped = [];
  const neutralised = [];
  for (const name of names) {
    if (!opts.includeClientData && CLIENT_DATA_MIGRATIONS[name]) {
      skipped.push({ name, reason: CLIENT_DATA_MIGRATIONS[name] });
      continue;
    }
    let sql = readFileSync(path.join(dir, name), "utf8").replace(/\r\n/g, "\n");
    const original = sha256(sql);
    if (!opts.keepBaselineSeeds && /^0000_/.test(name)) {
      for (const p of BASELINE_SEED_PATTERNS) {
        const before = sql;
        sql = sql.replace(p.re, (mm) => `-- [neutralised by build-fresh-schema.mjs: ${p.what}]\n` + mm.split("\n").map((l) => "-- " + l).join("\n"));
        if (sql !== before) neutralised.push({ name, what: p.what });
      }
    }
    included.push({ name, sql, hash: original });
  }
  const body = included.map((f) => `-- ===== BEGIN ${f.name} =====\n${f.sql.replace(/\n*$/, "\n")}-- ===== END ${f.name} =====\n`).join("\n");
  const overall = sha256(included.map((f) => f.name + ":" + f.hash).join("\n"));
  const { gaps, dupes } = numberGaps(names);
  const header = [
    "-- BPMSquare fresh-database schema. GENERATED by scripts/dedicated/build-fresh-schema.mjs. Do not edit; do not commit.",
    `-- overall-sha256 (source files, in order): ${overall}`,
    `-- body-sha256 (everything below the first "-- ===== BEGIN" line, as shipped): ${sha256(body)}`,
    `-- files: ${included.length}   skipped: ${skipped.length}   baseline seeds neutralised: ${neutralised.length}`,
    `-- numbering gaps (never existed in git, not a mistake): ${gaps.length ? gaps.map((g) => String(g).padStart(4, "0")).join(" ") : "none"}`,
    "-- order of application:",
    ...included.map((f, i) => `--   ${String(i + 1).padStart(3)}. ${f.name}  ${f.hash.slice(0, 12)}`),
    ...skipped.map((s) => `--   SKIPPED ${s.name}: ${s.reason}`),
    ...neutralised.map((s) => `--   NEUTRALISED in ${s.name}: ${s.what}`),
    "",
  ].join("\n");
  return { sql: header + "\n" + body, overall, bodyHash: sha256(body), included, skipped, neutralised, gaps, dupes, names };
}

export function renderReport(build, analysis, appScan, meta = {}) {
  const errors = analysis.findings.filter((f) => f.severity === SEVERITY.ERROR);
  const warns = analysis.findings.filter((f) => f.severity === SEVERITY.WARN);
  const infos = analysis.findings.filter((f) => f.severity === SEVERITY.INFO);
  const L = [];
  L.push(`# Fresh-schema report`);
  L.push("");
  L.push(`- overall sha256 (source files, in order): \`${build.overall}\``);
  L.push(`- body sha256 (as shipped): \`${build.bodyHash}\``);
  L.push(`- files applied: ${build.included.length}; skipped: ${build.skipped.length}; baseline seeds neutralised: ${build.neutralised.length}`);
  L.push(`- numbering gaps: ${build.gaps.length ? build.gaps.map((g) => String(g).padStart(4, "0")).join(", ") : "none"}; duplicate numbers: ${build.dupes.length ? build.dupes.join(", ") : "none"}`);
  L.push(`- tables created: ${analysis.tables.length}; functions: ${analysis.functions.length}; views: ${analysis.views.length}; storage buckets created by SQL: ${Object.keys(analysis.buckets).length}`);
  L.push(`- tables whose column list the reader could not follow (CREATE TABLE AS / LIKE), so column checks skip them: ${analysis.opaqueTables.length ? analysis.opaqueTables.join(", ") : "none"}`);
  L.push(`- extensions created by SQL: ${Object.keys(analysis.extensions).join(", ") || "none"}`);
  L.push(`- result: **${errors.length} error(s), ${warns.length} warning(s), ${infos.length} note(s)**`);
  L.push("");
  const section = (title, list) => {
    L.push(`## ${title} (${list.length})`);
    L.push("");
    if (!list.length) L.push("None.", "");
    else {
      for (const f of list) L.push(`- \`${f.file}:${f.line}\` [${f.code}] ${f.message}`);
      L.push("");
    }
  };
  section("Errors: cannot run on a clean database", errors);
  section("Warnings", warns);
  L.push("## Tenant-specific data in the SQL");
  L.push("");
  if (build.neutralised.length) for (const n of build.neutralised) L.push(`- neutralised in the fresh build: ${n.what} (${n.name})`);
  for (const s of build.skipped) L.push(`- left out of the fresh build: \`${s.name}\`: ${s.reason}`);
  const rest = analysis.tenantSeeds.filter((s) => !(s.file.startsWith("0000_") && build.neutralised.length));
  for (const s of rest) L.push(`- \`${s.file}:${s.line}\` still touches ${s.table} by hard-coded key: \`${s.text}\` (a no-op on a database without that row)`);
  L.push("");
  L.push("## Storage buckets");
  L.push("");
  L.push("| Bucket | Public | Created by |", "|---|---|---|");
  for (const [id, b] of Object.entries(analysis.buckets)) L.push(`| ${id} | ${b.public ? "yes" : "no"} | ${b.file} |`);
  L.push("");
  if (appScan) {
    L.push("## What the application uses that no migration creates");
    L.push("");
    const part = (title, list) => {
      L.push(`### ${title} (${list.length})`);
      if (!list.length) L.push("None.");
      for (const x of list) L.push(`- \`${x.name}\` (first used in \`${x.file}\`)`);
      L.push("");
    };
    part("Tables or views", appScan.missingTables);
    part("RPC functions", appScan.missingFunctions);
    part("Storage buckets", appScan.missingBuckets);
    L.push(`### Columns read by the code that no migration adds (${appScan.columnHits.length}, heuristic: check each by hand)`);
    if (!appScan.columnHits.length) L.push("None.");
    for (const x of appScan.columnHits) L.push(`- \`${x.table}.${x.column}\` (\`${x.file}\`)`);
    L.push("");
  }
  L.push(`## Notes (${infos.length})`);
  L.push("");
  for (const f of infos.slice(0, 80)) L.push(`- \`${f.file}:${f.line}\` [${f.code}] ${f.message}`);
  if (infos.length > 80) L.push(`- ... and ${infos.length - 80} more`);
  L.push("");
  if (meta.sqlOut) L.push(`Built file: \`${meta.sqlOut}\``);
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1];
}
const flag = (name) => process.argv.includes(name);

function main() {
  const dir = path.resolve(arg("--migrations", "supabase/migrations"));
  const out = path.resolve(arg("--out", "dist/dedicated/fresh-schema.sql"));
  const reportPath = path.resolve(arg("--report", path.join(path.dirname(out), "fresh-schema-report.md")));
  const appSrc = arg("--app-src", existsSync("src") ? "src" : null);
  if (!existsSync(dir)) {
    console.error(`migrations directory not found: ${dir}`);
    process.exit(2);
  }
  const build = buildFresh(dir, { keepBaselineSeeds: flag("--keep-baseline-seeds"), includeClientData: flag("--include-client-data") });
  const analysis = analyze(build.included.map((f) => ({ name: f.name, sql: f.sql })));
  const appScan = appSrc && existsSync(appSrc) ? scanApp(path.resolve(appSrc), analysis) : null;
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, build.sql);
  writeFileSync(reportPath, renderReport(build, analysis, appScan, { sqlOut: path.relative(process.cwd(), out) }));
  const errors = analysis.findings.filter((f) => f.severity === SEVERITY.ERROR).length;
  const warns = analysis.findings.filter((f) => f.severity === SEVERITY.WARN).length;
  console.log(`wrote ${path.relative(process.cwd(), out)} (${build.included.length} files, sha256 ${build.overall.slice(0, 16)})`);
  console.log(`wrote ${path.relative(process.cwd(), reportPath)}: ${errors} error(s), ${warns} warning(s)`);
  if (appScan) console.log(`application uses ${appScan.missingTables.length} table(s), ${appScan.missingFunctions.length} rpc(s), ${appScan.missingBuckets.length} bucket(s) that no migration creates`);
  process.exit(errors ? 1 : flag("--strict") && warns ? 2 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
