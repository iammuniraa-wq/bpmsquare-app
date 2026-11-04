// An in-memory stand-in for the service-role Supabase client, for the WBS tests (tender side and project side). Not a test file.
// It filters on eq / in / is / not, pages with range, enforces the unique keys it is told about (error 23505), cascades deletes the way the
// foreign keys of migration 0243 do, and answers a table or a column it is told is missing the way PostgREST does before a migration is applied.

export type Row = Record<string, unknown>;
export type DbError = { message: string; code?: string } | null;

export type FakeOpts = {
  /** Tables that do not exist yet (answer 42P01). */
  missingTables?: string[];
  /** Columns that do not exist yet, per table (answer 42703 when selected or written). */
  missingColumns?: Record<string, string[]>;
  /** Unique keys: table -> list of column sets. */
  unique?: Record<string, string[][]>;
  /** What a delete of rows in a table takes with it: table -> function(deleted rows, tables) run after the delete. */
  cascade?: Record<string, (gone: Row[], tables: Record<string, Row[]>) => void>;
  /** What a delete of rows in a table sets to null elsewhere (on delete set null). */
  setNull?: Record<string, { table: string; column: string; via: string }[]>;
};

let counter = 0;
const uuid = () => {
  counter++;
  const hex = counter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
};

export function fakeDb(seed: Record<string, Row[]> = {}, opts: FakeOpts = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const rows = (t: string) => (tables[t] ??= []);
  const log: { table: string; op: string; payload?: unknown }[] = [];
  const noTable = (t: string): DbError => (opts.missingTables?.includes(t) ? { message: `relation "${t}" does not exist`, code: "42P01" } : null);
  const noColumn = (t: string, text: string): DbError => {
    const hit = (opts.missingColumns?.[t] ?? []).find((c) => new RegExp(`\\b${c}\\b`).test(text));
    return hit ? { message: `column ${t}.${hit} does not exist`, code: "42703" } : null;
  };
  const clash = (t: string, row: Row, ignore?: Row): boolean =>
    (opts.unique?.[t] ?? []).some((cols) => rows(t).some((x) => x !== ignore && cols.every((c) => x[c] === row[c] && row[c] !== undefined)));

  class Q implements PromiseLike<{ data: unknown; error: DbError }> {
    private filters: ((r: Row) => boolean)[] = [];
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row | Row[] = {};
    private wantRows = false;
    private one: "single" | "maybe" | null = null;
    private lim: number | null = null;
    private ords: { col: string; asc: boolean }[] = [];
    private rng: [number, number] | null = null;
    private selected = "*";
    constructor(private table: string) {}
    select(cols?: string) { this.wantRows = true; if (cols) this.selected = cols; return this; }
    insert(r: Row | Row[]) { this.op = "insert"; this.payload = r; return this; }
    update(r: Row) { this.op = "update"; this.payload = r; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
    in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
    is(c: string, v: unknown) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
    not(c: string, op: string, v: unknown) { this.filters.push((r) => (op === "is" && v === null ? r[c] != null : r[c] !== v)); return this; }
    order(col: string, o?: { ascending?: boolean }) { this.ords.push({ col, asc: o?.ascending !== false }); return this; }
    limit(n: number) { this.lim = n; return this; }
    range(a: number, b: number) { this.rng = [a, b]; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    then<R1, R2>(res?: ((v: { data: unknown; error: DbError }) => R1 | PromiseLike<R1>) | null, rej?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      return Promise.resolve(this.run()).then(res, rej);
    }
    private run(): { data: unknown; error: DbError } {
      const t = rows(this.table);
      const bad = noTable(this.table);
      if (bad) return { data: null, error: bad };
      const match = (r: Row) => this.filters.every((f) => f(r));
      const touched = this.op === "select" ? this.selected : Object.keys(Array.isArray(this.payload) ? (this.payload[0] ?? {}) : this.payload).join(",");
      const badCol = noColumn(this.table, touched);
      if (badCol) return { data: null, error: badCol };
      log.push({ table: this.table, op: this.op, payload: this.payload });

      if (this.op === "insert") {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const made: Row[] = [];
        for (const p of list) {
          const row: Row = { id: uuid(), created_at: new Date().toISOString(), ...p };
          if (clash(this.table, row)) return { data: null, error: { message: `duplicate key value violates unique constraint on ${this.table}`, code: "23505" } };
          t.push(row);
          made.push(row);
        }
        return { data: this.one ? made[0] : this.wantRows ? made : null, error: null };
      }
      if (this.op === "update") {
        const hit = t.filter(match);
        for (const r of hit) {
          const next = { ...r, ...(this.payload as Row) };
          if (clash(this.table, next, r)) return { data: null, error: { message: `duplicate key value violates unique constraint on ${this.table}`, code: "23505" } };
        }
        for (const r of hit) Object.assign(r, this.payload);
        return { data: this.wantRows ? hit : null, error: null };
      }
      if (this.op === "delete") {
        const gone = t.filter(match);
        tables[this.table] = t.filter((r) => !match(r));
        for (const s of opts.setNull?.[this.table] ?? []) for (const x of rows(s.table)) if (gone.some((g) => g.id === x[s.via])) x[s.column] = null;
        opts.cascade?.[this.table]?.(gone, tables);
        return { data: null, error: null };
      }
      let out = t.filter(match);
      for (const { col, asc } of [...this.ords].reverse()) {
        out = [...out].sort((a, b) => {
          const x = a[col], y = b[col];
          return (x === y ? 0 : (x as number | string) < (y as number | string) ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim !== null) out = out.slice(0, this.lim);
      if (this.one) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
  }
  return { client: { from: (t: string) => new Q(t) } as never, tables, log };
}
