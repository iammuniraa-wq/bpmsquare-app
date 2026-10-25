import { describe, expect, it, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  analyze, buildFresh, listMigrationFiles, numberGaps, splitStatements,
} from "../../../scripts/dedicated/build-fresh-schema.mjs";

// Guards the dedicated-instance kit (docs/dedicated-instance.md): the migrations folder must stay replayable on an empty
// database, in file order. The reader is a static one, so these tests pin both what it catches and what it must not flag.

const made: string[] = [];
function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "fresh-schema-"));
  made.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(path.join(dir, name), sql);
  return dir;
}
afterAll(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const BASE = `
create extension if not exists "pgcrypto";
create table platform_admins (id uuid primary key default gen_random_uuid(), email text not null unique);
insert into platform_admins (email) values ('owner@example.com');
create table tenants (id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null,
  accent_color text not null default '#000', status text, plan text, features jsonb);
insert into tenants (slug, name, accent_color, status, plan, features)
values ('vikas', 'Pilot', '#FF6B00', 'active', 'pro', '{"leads": true}'::jsonb);
create table accounts (id uuid primary key, tenant_id uuid not null references tenants(id), name text not null);
`;

describe("file order", () => {
  it("puts the baseline first and sorts numerically, not alphabetically", () => {
    const dir = fixture({ "0100_c.sql": "", "0099_b.sql": "", "0000_baseline.sql": "", "0030_a.sql": "", "0031_x.sql": "" });
    expect(listMigrationFiles(dir)).toEqual(["0000_baseline.sql", "0030_a.sql", "0031_x.sql", "0099_b.sql", "0100_c.sql"]);
  });

  it("reports gaps from 0030 up and ignores the archived 0001-0029 range", () => {
    const { gaps, dupes } = numberGaps(["0000_baseline.sql", "0030_a.sql", "0033_b.sql", "0033_c.sql"]);
    expect(gaps).toEqual([31, 32]);
    expect(dupes).toEqual([33]);
  });
});

describe("build and hash", () => {
  it("lists the order in the header and hashes deterministically", () => {
    const files = { "0000_baseline.sql": BASE, "0030_a.sql": "alter table accounts add column city text;" };
    const one = buildFresh(fixture(files));
    const two = buildFresh(fixture(files));
    expect(one.overall).toBe(two.overall);
    expect(one.bodyHash).toBe(two.bodyHash);
    expect(one.sql).toContain("-- order of application:");
    expect(one.sql.indexOf("0000_baseline.sql")).toBeLessThan(one.sql.indexOf("0030_a.sql"));
    expect(one.sql).toContain(`overall-sha256 (source files, in order): ${one.overall}`);
    const changed = buildFresh(fixture({ ...files, "0030_a.sql": "alter table accounts add column town text;" }));
    expect(changed.overall).not.toBe(one.overall);
    expect(changed.bodyHash).not.toBe(one.bodyHash);
  });

  it("neutralises the baseline's owner e-mail and pilot tenant, and keeps them with --keep-baseline-seeds", () => {
    const dir = fixture({ "0000_baseline.sql": BASE });
    const plain = buildFresh(dir);
    expect(plain.neutralised).toHaveLength(2);
    const live = plain.sql.split("\n").filter((l) => !l.startsWith("--"));
    expect(live.join("\n")).not.toMatch(/owner@example\.com/);
    expect(live.join("\n")).not.toMatch(/'vikas'/);
    const kept = buildFresh(dir, { keepBaselineSeeds: true });
    expect(kept.neutralised).toHaveLength(0);
    expect(kept.sql).toContain("insert into platform_admins (email) values ('owner@example.com');");
  });

  it("leaves a pure client-data migration out unless asked", () => {
    const dir = fixture({ "0000_baseline.sql": BASE, "0031_copy_vikas_pioneers_entity_profile.sql": "update tenants set name = 'x' where slug = 'vikas-pioneers';" });
    expect(buildFresh(dir).included.map((f: { name: string }) => f.name)).toEqual(["0000_baseline.sql"]);
    expect(buildFresh(dir, { includeClientData: true }).included).toHaveLength(2);
  });

  it("builds the neutralised baseline into SQL that still parses to the same tables", () => {
    const built = buildFresh(fixture({ "0000_baseline.sql": BASE }));
    const a = analyze(built.included.map((f: { name: string; sql: string }) => ({ name: f.name, sql: f.sql })));
    expect(a.tables).toEqual(["platform_admins", "tenants", "accounts"]);
    expect(a.findings).toEqual([]);
  });
});

describe("the checker flags what cannot run on a clean database", () => {
  const codes = (files: { name: string; sql: string }[]) => analyze(files).findings.map((f: { severity: string; code: string }) => `${f.severity}:${f.code}`);

  it("ALTER TABLE on a table that nothing created", () => {
    expect(codes([{ name: "0000_b.sql", sql: BASE }, { name: "0030_x.sql", sql: "alter table ghost add column a int;" }])).toEqual(["ERROR:MISSING_TABLE"]);
  });

  it("a table that is only created by a LATER file", () => {
    const f = [
      { name: "0000_b.sql", sql: BASE },
      { name: "0030_early.sql", sql: "alter table later add column a int;" },
      { name: "0031_late.sql", sql: "create table later (id uuid primary key);" },
    ];
    expect(codes(f)).toEqual(["ERROR:MISSING_TABLE"]);
  });

  it("a foreign key to a table that does not exist yet", () => {
    expect(codes([{ name: "0000_b.sql", sql: BASE }, { name: "0030_x.sql", sql: "create table t (id uuid, opp uuid references opportunities(id));" }])).toEqual(["ERROR:MISSING_TABLE"]);
  });

  it("an index on a column nothing created, INSERT/UPDATE on a missing table", () => {
    const f = [
      { name: "0000_b.sql", sql: BASE },
      { name: "0030_x.sql", sql: "create index on accounts (tenant_id, nickname); insert into nowhere (a) values (1); update nowhere2 set a = 1;" },
    ];
    expect(codes(f)).toEqual(["ERROR:MISSING_COLUMN", "ERROR:MISSING_TABLE", "ERROR:MISSING_TABLE"]);
  });

  it("pg_trgm index syntax before the extension is created", () => {
    const f = [
      { name: "0000_b.sql", sql: BASE },
      { name: "0030_x.sql", sql: "create index accounts_name_idx on accounts using gin (name gin_trgm_ops);" },
    ];
    expect(codes(f)).toEqual(["ERROR:MISSING_EXTENSION"]);
    const ok = [...f.slice(0, 1), { name: "0029_ext.sql", sql: "create extension if not exists pg_trgm;" }, f[1]];
    expect(codes(ok)).toEqual([]);
  });

  it("DROP POLICY without if exists on a policy nobody created; unnamed constraint drops only warn", () => {
    const f = [
      { name: "0000_b.sql", sql: BASE },
      { name: "0030_x.sql", sql: `drop policy "accounts: gone" on accounts; alter table accounts drop constraint accounts_status_check;` },
    ];
    expect(codes(f)).toEqual(["ERROR:DROP_MISSING_POLICY", "WARN:DROP_UNKNOWN_CONSTRAINT"]);
  });

  it("does not flag guarded or ordinary statements", () => {
    const f = [
      { name: "0000_b.sql", sql: BASE },
      {
        name: "0030_ok.sql",
        sql: `
          alter table if exists ghost add column a int;
          alter table accounts add column if not exists city text;
          create index if not exists accounts_city_idx on accounts (tenant_id, city);
          create policy "accounts: tenant isolation" on accounts for all using (true);
          drop policy if exists "accounts: other" on accounts;
          do $$ begin
            if exists (select 1 from information_schema.tables where table_name = 'ghost') then
              alter table ghost add column b int;
            end if;
          end $$;
          insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict (id) do nothing;
          create policy "files read" on storage.objects for select using (bucket_id = 'files');
        `,
      },
    ];
    const a = analyze(f);
    expect(a.findings.filter((x: { severity: string }) => x.severity === "ERROR")).toEqual([]);
    expect(a.buckets).toEqual({ files: { file: "0030_ok.sql", public: false } });
  });
});

describe("statement reader", () => {
  it("splits on semicolons but not inside quotes, comments or dollar bodies", () => {
    const sql = `-- a; comment
      select 'a;b'; /* x; y */ select 2;
      create function f() returns int language plpgsql as $f$ begin return 1; end $f$;
      select "we;ird";`;
    const st = splitStatements(sql).map((s: { text: string }) => s.text);
    expect(st).toHaveLength(4);
    expect(st[2]).toContain("return 1; end");
  });

  it("keeps line numbers pointing at the first line of the statement", () => {
    const st = splitStatements("select 1;\n\n-- note\nselect 2;\nselect\n 3;");
    expect(st.map((s: { line: number }) => s.line)).toEqual([1, 4, 5]);
  });
});

describe("the repository's own migrations", () => {
  it("replay on an empty database without an error the reader can see", () => {
    const dir = path.resolve(__dirname, "../../../supabase/migrations");
    const built = buildFresh(dir);
    const a = analyze(built.included.map((f: { name: string; sql: string }) => ({ name: f.name, sql: f.sql })));
    const errors = a.findings.filter((f: { severity: string }) => f.severity === "ERROR");
    expect(errors, errors.map((e: { file: string; line: number; message: string }) => `${e.file}:${e.line} ${e.message}`).join("\n")).toEqual([]);
    expect(built.included[0].name).toBe("0000_baseline.sql");
    expect(Object.keys(a.buckets)).toContain("deal-room-files");
  });
});
