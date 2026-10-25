// A small in-memory stand-in for the Supabase client, enough for the Inbox tests: the query shapes src/lib/inbox uses
// (eq / in / is / not / lt / lte / gt / gte / or / order / limit / range / single / maybeSingle, insert / update / upsert /
// delete, exact counts) over arrays of rows, unique-constraint errors (23505) and a storage bucket. It is a test helper,
// not product code: nothing outside *.test.ts imports it.

import { randomUUID } from "node:crypto";

export type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string; details?: string } | null; count?: number | null };
type Pred = (r: Row) => boolean;
type Conflict = (existing: Row, incoming: Row) => boolean;

const asTime = (v: unknown) => (typeof v === "string" ? Date.parse(v) : Number.NaN);
const cmp = (a: unknown, b: unknown): number => {
  if (typeof a === "string" && typeof b === "string") {
    const ta = asTime(a), tb = asTime(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return Number(a) - Number(b);
};

export class MemoryDb {
  tables: Record<string, Row[]> = {};
  conflicts: Record<string, Conflict[]> = {};
  storageObjects = new Map<string, { content: Buffer; contentType?: string }>();
  failUploads = false;
  users = new Map<string, { email: string; name?: string }>();
  auth = {
    admin: {
      getUserById: async (id: string) => {
        const u = this.users.get(id);
        return { data: { user: u ? { id, email: u.email, user_metadata: { full_name: u.name } } : null }, error: null };
      },
    },
  };
  /** Tables that answer "does not exist" (migration pending). */
  missing = new Set<string>();
  /** Columns that do not exist yet (a migration that adds a column is pending): a select naming one, or a write carrying one, answers 42703. */
  missingColumns: Record<string, Set<string>> = {};

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [t, rows] of Object.entries(seed)) this.tables[t] = rows.map((r) => ({ ...r }));
  }

  rows(table: string): Row[] {
    return (this.tables[table] ??= []);
  }

  unique(table: string, fn: Conflict) {
    (this.conflicts[table] ??= []).push(fn);
  }

  from(table: string) {
    return new Query(this, table);
  }

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, content: Buffer, opts?: { contentType?: string; upsert?: boolean }) => {
        if (this.failUploads) return { data: null, error: { message: "upload failed" } };
        const key = `${bucket}/${path}`;
        if (this.storageObjects.has(key) && !opts?.upsert) return { data: null, error: { message: "exists" } };
        this.storageObjects.set(key, { content: Buffer.from(content), contentType: opts?.contentType });
        return { data: { path }, error: null };
      },
      download: async (path: string) => {
        const o = this.storageObjects.get(`${bucket}/${path}`);
        if (!o) return { data: null, error: { message: "not found" } };
        return { data: { arrayBuffer: async () => o.content.buffer.slice(o.content.byteOffset, o.content.byteOffset + o.content.byteLength) }, error: null };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) this.storageObjects.delete(`${bucket}/${p}`);
        return { data: paths, error: null };
      },
      copy: async (from: string, to: string) => {
        const o = this.storageObjects.get(`${bucket}/${from}`);
        if (!o) return { data: null, error: { message: "not found" } };
        this.storageObjects.set(`${bucket}/${to}`, { ...o });
        return { data: { path: to }, error: null };
      },
      createSignedUrl: async (path: string, seconds: number, opts?: { download?: string | boolean }) => {
        if (!this.storageObjects.has(`${bucket}/${path}`)) return { data: null, error: { message: "not found" } };
        return { data: { signedUrl: `https://signed.test/${bucket}/${path}?t=${seconds}${opts?.download ? `&download=${encodeURIComponent(String(opts.download))}` : ""}` }, error: null };
      },
    }),
  };

  objectsIn(bucket: string): string[] {
    return [...this.storageObjects.keys()].filter((k) => k.startsWith(`${bucket}/`)).map((k) => k.slice(bucket.length + 1));
  }
}

class Query implements PromiseLike<Result> {
  private preds: Pred[] = [];
  private mode: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private payload: Row | Row[] | null = null;
  private onConflict: string | null = null;
  private orderBy: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private from_: number | null = null;
  private to_: number | null = null;
  private wantCount = false;
  private head = false;
  private single_: "single" | "maybe" | null = null;
  private returning = false;
  private touched: Row[] = [];
  private cols: string | null = null;

  constructor(private db: MemoryDb, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode === "select" && typeof _cols === "string") this.cols = _cols;
    if (this.mode !== "select") this.returning = true;
    this.wantCount = opts?.count === "exact";
    this.head = !!opts?.head;
    return this;
  }
  insert(p: Row | Row[]) { this.mode = "insert"; this.payload = p; return this; }
  update(p: Row) { this.mode = "update"; this.payload = p; return this; }
  upsert(p: Row | Row[], opts?: { onConflict?: string }) { this.mode = "upsert"; this.payload = p; this.onConflict = opts?.onConflict ?? null; return this; }
  delete() { this.mode = "delete"; return this; }

  eq(col: string, v: unknown) { this.preds.push((r) => r[col] === v); return this; }
  neq(col: string, v: unknown) { this.preds.push((r) => r[col] !== v); return this; }
  in(col: string, vs: readonly unknown[]) { this.preds.push((r) => vs.includes(r[col])); return this; }
  is(col: string, v: null) { this.preds.push((r) => (v === null ? r[col] === null || r[col] === undefined : r[col] === v)); return this; }
  not(col: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.preds.push((r) => r[col] !== null && r[col] !== undefined);
    return this;
  }
  lt(col: string, v: unknown) { this.preds.push((r) => r[col] != null && cmp(r[col], v) < 0); return this; }
  lte(col: string, v: unknown) { this.preds.push((r) => r[col] != null && cmp(r[col], v) <= 0); return this; }
  gt(col: string, v: unknown) { this.preds.push((r) => r[col] != null && cmp(r[col], v) > 0); return this; }
  gte(col: string, v: unknown) { this.preds.push((r) => r[col] != null && cmp(r[col], v) >= 0); return this; }
  contains(col: string, v: Record<string, unknown>) { this.preds.push((r) => Object.entries(v).every(([k, x]) => (r[col] as Row | undefined)?.[k] === x)); return this; }
  or(expr: string) {
    const parts = expr.split(",").map((p) => {
      const m = /^(\w+)\.(ilike|eq|is)\.(.*)$/.exec(p);
      if (!m) throw new Error(`MemoryDb.or cannot read "${p}"`);
      const [, col, op, val] = m;
      if (op === "is") return (r: Row) => r[col] === null || r[col] === undefined;
      if (op === "eq") return (r: Row) => r[col] === val;
      const needle = val.replace(/^%|%$/g, "").toLowerCase();
      return (r: Row) => typeof r[col] === "string" && (r[col] as string).toLowerCase().includes(needle);
    });
    this.preds.push((r) => parts.some((f) => f(r)));
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy = { col, asc: opts?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.from_ = a; this.to_ = b; return this; }
  single() { this.single_ = "single"; return this; }
  maybeSingle() { this.single_ = "maybe"; return this; }

  private match(): Row[] { return this.db.rows(this.table).filter((r) => this.preds.every((p) => p(r))); }

  private run(): Result {
    if (this.db.missing.has(this.table)) return { data: null, error: { code: "42P01", message: `relation "${this.table}" does not exist` } };
    const gone = this.db.missingColumns[this.table];
    if (gone && gone.size > 0) {
      const named = this.cols ? this.cols.split(",").map((x) => x.trim()) : [];
      const written = this.payload ? (Array.isArray(this.payload) ? this.payload : [this.payload]).flatMap((r) => Object.keys(r)) : [];
      const bad = [...named, ...written].find((c) => gone.has(c));
      if (bad) return { data: null, error: { code: "42703", message: `column "${bad}" does not exist` } };
    }
    const rows = this.db.rows(this.table);
    let out: Row[] = [];

    if (this.mode === "insert" || this.mode === "upsert") {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
      for (const raw of list) {
        const row: Row = { id: raw.id ?? randomUUID(), created_at: new Date().toISOString(), ...raw };
        if (this.mode === "upsert" && this.onConflict) {
          const keys = this.onConflict.split(",");
          const hit = rows.find((e) => keys.every((k) => e[k] === row[k]));
          if (hit) { Object.assign(hit, raw); out.push(hit); continue; }
        }
        const clash = (this.db.conflicts[this.table] ?? []).some((fn) => rows.some((e) => fn(e, row)));
        if (clash) return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${this.table}` } };
        rows.push(row);
        out.push(row);
      }
      this.touched = out;
    } else if (this.mode === "update") {
      out = this.match();
      for (const r of out) for (const [k, v] of Object.entries(this.payload as Row)) if (v !== undefined) r[k] = v;
      this.touched = out;
    } else if (this.mode === "delete") {
      out = this.match();
      this.db.tables[this.table] = rows.filter((r) => !out.includes(r));
      this.touched = out;
    } else {
      out = this.match();
    }

    if (this.mode !== "select" && !this.returning) return { data: null, error: null };

    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out = [...out].sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]));
    }
    const total = out.length;
    if (this.from_ !== null && this.to_ !== null) out = out.slice(this.from_, this.to_ + 1);
    if (this.lim !== null) out = out.slice(0, this.lim);
    const count = this.wantCount ? total : null;
    if (this.head) return { data: null, error: null, count };
    const clone = out.map((r) => ({ ...r }));
    if (this.single_) {
      if (clone.length === 0) return this.single_ === "single" ? { data: null, error: { code: "PGRST116", message: "no rows" }, count } : { data: null, error: null, count };
      return { data: clone[0], error: null, count };
    }
    return { data: clone, error: null, count };
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }
}
