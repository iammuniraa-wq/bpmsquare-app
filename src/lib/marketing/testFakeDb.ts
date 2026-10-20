import type { SupabaseClient } from "@supabase/supabase-js";

// An in-memory stand-in for the service-role client, just enough of the query
// builder for the marketing libraries' tests. Not a test file and never
// imported by app code.

export type Row = Record<string, unknown>;
type DbError = { code?: string; message: string } | null;

export function fakeDb(seed: Record<string, Row[]> = {}, opts: { missingTables?: string[] } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const missing = new Set(opts.missingTables ?? []);
  const rows = (t: string) => (tables[t] ??= []);
  const queries: { table: string; op: string; filters: Record<string, unknown> }[] = [];
  let n = 0;

  class Q implements PromiseLike<{ data: unknown; error: DbError }> {
    private filters: { col: string; test: (v: unknown) => boolean; val?: unknown }[] = [];
    private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    private payload: Row | Row[] = {};
    private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
    private one: "single" | "maybe" | null = null;
    private lim: number | null = null;
    private rangeFrom: number | null = null;
    private rangeTo: number | null = null;
    constructor(private table: string) {}
    select() { return this; }
    insert(r: Row | Row[]) { this.op = "insert"; this.payload = r; return this; }
    update(r: Row) { this.op = "update"; this.payload = r; return this; }
    upsert(r: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = r; this.upsertOpts = o; return this; }
    delete() { this.op = "delete"; return this; }
    eq(col: string, val: unknown) { this.filters.push({ col, val, test: (v) => v === val }); return this; }
    is(col: string, val: unknown) { this.filters.push({ col, val, test: (v) => (val === null ? v == null : v === val) }); return this; }
    in(col: string, vals: unknown[]) { this.filters.push({ col, test: (v) => vals.includes(v) }); return this; }
    neq(col: string, val: unknown) { this.filters.push({ col, test: (v) => v !== val }); return this; }
    like(col: string, pattern: string) {
      const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
      this.filters.push({ col, test: (v) => typeof v === "string" && re.test(v) });
      return this;
    }
    range(from: number, to: number) { this.rangeFrom = from; this.rangeTo = to; return this; }
    gte(col: string, val: unknown) { this.filters.push({ col, test: (v) => String(v ?? "") >= String(val) }); return this; }
    lt(col: string, val: unknown) { this.filters.push({ col, test: (v) => v != null && String(v) < String(val) }); return this; }
    lte(col: string, val: unknown) { this.filters.push({ col, test: (v) => v != null && String(v) <= String(val) }); return this; }
    not() { return this; }
    order() { return this; }
    limit(x: number) { this.lim = x; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    then<R1, R2>(res?: ((v: { data: unknown; error: DbError }) => R1 | PromiseLike<R1>) | null, rej?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      return Promise.resolve(this.run()).then(res, rej);
    }
    private run(): { data: unknown; error: DbError } {
      queries.push({ table: this.table, op: this.op, filters: Object.fromEntries(this.filters.filter((f) => "val" in f).map((f) => [f.col, f.val])) });
      if (missing.has(this.table)) {
        return { data: null, error: { code: "42P01", message: `relation "${this.table}" does not exist` } };
      }
      const t = rows(this.table);
      const match = (r: Row) => this.filters.every((f) => f.test(r[f.col]));
      if (this.op === "insert") {
        if (Array.isArray(this.payload)) {
          const made = (this.payload as Row[]).map((p) => ({ id: `id-${++n}`, ...p }));
          t.push(...made);
          return { data: made, error: null };
        }
        const row: Row = { id: `id-${++n}`, ...(this.payload as Row) };
        t.push(row);
        return { data: this.one ? row : [row], error: null };
      }
      if (this.op === "upsert" && Array.isArray(this.payload)) {
        const keys = (this.upsertOpts.onConflict ?? "id").split(",").map((s) => s.trim());
        const out: Row[] = [];
        for (const p of this.payload as Row[]) {
          const found = t.find((r) => keys.every((k) => r[k] === p[k]));
          if (found) {
            if (!this.upsertOpts.ignoreDuplicates) Object.assign(found, p);
            out.push(found);
          } else {
            const row: Row = { id: `id-${++n}`, ...p };
            t.push(row);
            out.push(row);
          }
        }
        return { data: out, error: null };
      }
      if (this.op === "upsert") {
        const keys = (this.upsertOpts.onConflict ?? "id").split(",").map((s) => s.trim());
        const written: Row[] = [];
        for (const p of Array.isArray(this.payload) ? this.payload : [this.payload]) {
          const existing = t.find((r) => keys.every((k) => r[k] === p[k]));
          if (existing) {
            if (!this.upsertOpts.ignoreDuplicates) Object.assign(existing, p);
            written.push(existing);
          } else {
            const row: Row = { id: `id-${++n}`, ...p };
            t.push(row);
            written.push(row);
          }
        }
        return { data: this.one ? written[0] : written, error: null };
      }
      if (this.op === "update") {
        const hit = t.filter(match);
        for (const r of hit) Object.assign(r, this.payload as Row);
        return { data: hit, error: null };
      }
      if (this.op === "delete") {
        const keep = t.filter((r) => !match(r));
        const gone = t.length - keep.length;
        tables[this.table] = keep;
        return { data: Array.from({ length: gone }), error: null };
      }
      let out = t.filter(match);
      if (this.rangeFrom !== null && this.rangeTo !== null) out = out.slice(this.rangeFrom, this.rangeTo + 1);
      if (this.lim !== null) out = out.slice(0, this.lim);
      if (this.one === "single") return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: "PGRST116", message: "no single row" } };
      if (this.one === "maybe") return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
  }

  const client = { from: (table: string) => new Q(table) } as unknown as SupabaseClient;
  return { client, tables, queries };
}
