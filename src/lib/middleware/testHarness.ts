// An in-memory stand-in for the service-role Supabase client, rich enough for
// the middleware's reads (keyset `or`, ranges, counts, ordering) and writes.
// A table listed in `missing` answers like PostgREST does for a table the
// owner has not created yet (42P01). Not a test file.

export type Row = Record<string, unknown>;
export type DbError = { message: string; code?: string } | null;

const MISSING: DbError = { message: 'relation "public.x" does not exist', code: "42P01" };

function parseOr(expr: string): (r: Row) => boolean {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) parts.push(cur);
  const preds = parts.map((p): ((r: Row) => boolean) => {
    const and = /^and\((.*)\)$/.exec(p);
    if (and) {
      const subs = and[1].split(",").map((x) => cond(x));
      return (r) => subs.every((f) => f(r));
    }
    return cond(p);
  });
  return (r) => preds.some((f) => f(r));
}

function cond(p: string): (r: Row) => boolean {
  const m = /^([a-z_]+)\.(eq|lt|gt|lte|gte)\.(.*)$/.exec(p);
  if (!m) return () => false;
  const [, col, op, v] = m;
  return (r) => {
    const x = r[col];
    if (x === undefined || x === null) return false;
    const a = typeof x === "string" ? x : String(x);
    if (op === "eq") return a === v;
    if (op === "lt") return a < v;
    if (op === "gt") return a > v;
    if (op === "lte") return a <= v;
    return a >= v;
  };
}

export function fakeAdmin(seed: Record<string, Row[]> = {}, opts: { missing?: string[]; failInsert?: (table: string, row: Row) => DbError; failUpdate?: (table: string, patch: Row) => DbError } = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const missing = new Set(opts.missing ?? []);
  let n = 0;
  const rows = (t: string) => (tables[t] ??= []);
  const log: { table: string; op: string; filters: string[] }[] = [];

  class Q implements PromiseLike<{ data: unknown; error: DbError; count?: number | null }> {
    private filters: ((r: Row) => boolean)[] = [];
    private described: string[] = [];
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row = {};
    private one: "single" | "maybe" | null = null;
    private lim: number | null = null;
    private ords: { col: string; asc: boolean }[] = [];
    private rng: [number, number] | null = null;
    private head = false;
    private countMode = false;
    constructor(private table: string) {}
    select(_c?: string, o?: { count?: string; head?: boolean }) { if (o?.count) this.countMode = true; if (o?.head) this.head = true; return this; }
    insert(r: Row) { this.op = "insert"; this.payload = r; return this; }
    update(r: Row) { this.op = "update"; this.payload = r; return this; }
    delete() { this.op = "delete"; return this; }
    private f(desc: string, fn: (r: Row) => boolean) { this.described.push(desc); this.filters.push(fn); return this; }
    eq(c: string, v: unknown) { return this.f(`${c}=${String(v)}`, (r) => r[c] === v); }
    in(c: string, vs: unknown[]) { return this.f(`${c} in`, (r) => vs.includes(r[c])); }
    lt(c: string, v: unknown) { return this.f(`${c}<`, (r) => r[c] != null && String(r[c]) < String(v)); }
    lte(c: string, v: unknown) { return this.f(`${c}<=`, (r) => r[c] != null && String(r[c]) <= String(v)); }
    gt(c: string, v: unknown) { return this.f(`${c}>`, (r) => r[c] != null && String(r[c]) > String(v)); }
    gte(c: string, v: unknown) { return this.f(`${c}>=`, (r) => r[c] != null && String(r[c]) >= String(v)); }
    not(c: string, _op: string, _v: unknown) { return this.f(`${c} notnull`, (r) => r[c] != null); }
    filter(c: string, _op: string, v: unknown) { return this.f(`${c} filter`, (r) => String((r.features as Record<string, unknown> | undefined)?.[c.split(">>")[1]?.replace(/'/g, "") ?? ""] ?? "") === String(v)); }
    // Only the exact-name form the webhooks library uses (the pattern has no wildcard): case-insensitive equality.
    ilike(c: string, pattern: string) { const want = pattern.split("\\").join("").toLowerCase(); return this.f(`${c} ilike`, (r) => String(r[c] ?? "").toLowerCase() === want); }
    or(expr: string) { return this.f(`or ${expr}`, parseOr(expr)); }
    order(col: string, o?: { ascending?: boolean }) { this.ords.push({ col, asc: o?.ascending !== false }); return this; }
    limit(n2: number) { this.lim = n2; return this; }
    range(a: number, b: number) { this.rng = [a, b]; return this; }
    single() { this.one = "single"; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    then<R1, R2>(res?: ((v: { data: unknown; error: DbError; count?: number | null }) => R1 | PromiseLike<R1>) | null, rej?: ((e: unknown) => R2 | PromiseLike<R2>) | null) {
      return Promise.resolve(this.run()).then(res, rej);
    }
    private run(): { data: unknown; error: DbError; count?: number | null } {
      log.push({ table: this.table, op: this.op, filters: this.described });
      if (missing.has(this.table)) return { data: null, error: { ...MISSING, message: `relation "public.${this.table}" does not exist` } };
      const t = rows(this.table);
      const match = (r: Row) => this.filters.every((f) => f(r));
      if (this.op === "insert") {
        const bad = opts.failInsert?.(this.table, this.payload);
        if (bad) return { data: null, error: bad };
        const row: Row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, created_at: new Date(Date.UTC(2026, 9, 21, 10, 0, n)).toISOString(), ...this.payload };
        // 0129's unique (tenant, connector, entity, external_id) and 0201's partial unique
        // index on the claim row of a sent quote (direction = 'push', entity = 'standard_quotes').
        const dup = this.table === "connector_links" && t.some((x) => ["tenant_id", "connector_id", "entity", "external_id"].every((k) => x[k] === row[k])
          || (row.direction === "push" && row.entity === "standard_quotes" && x.direction === "push" && x.entity === "standard_quotes"
            && ["tenant_id", "connector_id", "object_id"].every((k) => x[k] === row[k])));
        if (dup) return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
        t.push(row);
        return { data: this.one ? row : [row], error: null };
      }
      if (this.op === "update") {
        const bad = opts.failUpdate?.(this.table, this.payload);
        if (bad) return { data: null, error: bad };
        const hit = t.filter(match);
        for (const r of hit) Object.assign(r, this.payload);
        return { data: this.one ? hit[0] ?? null : hit, error: null };
      }
      if (this.op === "delete") {
        tables[this.table] = t.filter((r) => !match(r));
        return { data: null, error: null };
      }
      let out = t.filter(match);
      if (this.ords.length) {
        out = [...out].sort((a, b) => {
          for (const { col, asc } of this.ords) {
            const x = String(a[col] ?? "");
            const y = String(b[col] ?? "");
            if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
      }
      const total = out.length;
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim !== null) out = out.slice(0, this.lim);
      if (this.head) return { data: null, error: null, count: total };
      if (this.one) return { data: out[0] ?? null, error: null };
      return { data: out, error: null, ...(this.countMode ? { count: total } : {}) };
    }
  }
  return { client: { from: (t: string) => new Q(t) } as never, tables, log };
}

export const T1 = "11111111-1111-4111-8111-111111111111";
export const T2 = "22222222-2222-4222-8222-222222222222";

/** Dataverse connector rows + a tenant with the flag on. */
export function seedMiddleware(over: {
  product?: "dataverse" | "fo" | "bc"; features?: Record<string, boolean>; mwConfig?: Record<string, unknown>;
  cfg?: Record<string, unknown>; tenantId?: string;
} = {}): Record<string, Row[]> {
  const tid = over.tenantId ?? T1;
  const product = over.product ?? "dataverse";
  const env = product === "dataverse" ? "https://org.crm.dynamics.com" : product === "fo" ? "https://x.operations.dynamics.com" : "Production";
  return {
    tenants: [{
      id: tid, custom_domain: "acme.example.com",
      features: { standard_quotes: true, integration_middleware: true, accounts: true, fence_projects: true, estimator: true, ...(over.features ?? {}) },
      config: over.mwConfig ? { integration_middleware: over.mwConfig } : {},
    }],
    tenant_connectors: [{
      tenant_id: tid, connector_id: "dynamics365", status: "connected", last_error: null,
      config: {
        product, auth_mode: "client_secret", environment_url: env, directory_id: "contoso.com", client_id: "00000000-0000-0000-0000-000000000000",
        schedule: "off", entities: {}, ...(product === "dataverse" ? { price_list_id: "pl-0001", currency_id: "cur-0001" } : {}), ...(over.cfg ?? {}),
      },
      credentials: { access_token: "tok", expires_at: String(Date.now() + 3_600_000) },
    }],
    accounts: [{ id: "acc-1", tenant_id: tid, name: "A. Datum Corporation" }],
    connector_links: [{
      tenant_id: tid, connector_id: "dynamics365", entity: "customers", object_type: "accounts", object_id: "acc-1",
      external_id: "00000000-aaaa-4aaa-8aaa-000000000001", external_key: "ACC-1", direction: "pull", created_at: "2026-10-01T00:00:00.000Z",
    }],
    standard_quotes: [{
      id: "q-1", tenant_id: tid, ref: "SQ-0001", account_id: "acc-1", contact_id: null, status: "accepted", valid_until: null, terms: "Net 30", notes: "Deliver in two phases",
      subtotal: 125, total: 143.75, header_discount_pct: 0, tax_pct: 15, shipping_amount: 0, intro_text: null,
    }],
    standard_quote_lines: [
      { tenant_id: tid, standard_quote_id: "q-1", sl_no: "1", description: "Fence post 2.4 m", uom: "pcs", qty: 10, rate: 10, discount_pct: 0, amount: 100, is_selected: true },
      { tenant_id: tid, standard_quote_id: "q-1", sl_no: "2", description: "Gate, single swing", uom: "pcs", qty: 1, rate: 25, discount_pct: 0, amount: 25, is_selected: true },
    ],
    integration_messages: [],
  };
}
