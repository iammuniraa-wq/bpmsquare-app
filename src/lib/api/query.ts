// Enriched-REST query engine for the v1 API.
//
// Turns URL query params into a validated, safe query and applies it to a
// result set the route has already fetched (so it inherits that fetch's tenant
// scoping and PII decryption -- this engine never builds SQL, so there is no
// injection surface and no way to reach outside the caller's tenant).
//
// Supported params (all optional, all composable):
//   select=ref,total,account.name        projection (dotted for nested)
//   sort=-total,ref                       multi-key; leading "-" = descending
//   filter=status:eq:draft;total:gte:50000;name:like:pump
//                                         ";"-separated field:op:value triples (AND)
//   page=1  limit=50                      offset pagination (limit clamped to 200)
//   aggregate=count,sum:total,avg:total   inline aggregates over the FILTERED set
//
// ops: eq ne gt gte lt lte like in isnull  (in = comma list; isnull = true|false)
//
// Every field referenced by select/sort/filter/aggregate must be in the
// route-supplied `fields` whitelist, else a 422 with the accepted list -- so a
// typo in a bulk load fails loudly instead of silently returning everything.

export type QueryableType = "string" | "number" | "boolean" | "date";
export type QueryableField = { path: string; type: QueryableType };

export type FilterOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "isnull";
const OPS: readonly FilterOp[] = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "in", "isnull"];

export type AggFn = "count" | "sum" | "avg" | "min" | "max";
const AGG_FNS: readonly AggFn[] = ["count", "sum", "avg", "min", "max"];

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type Filter = { path: string; op: FilterOp; value: unknown };
type Sort = { path: string; dir: "asc" | "desc" };
type Agg = { fn: AggFn; path?: string };

export type ParsedQuery = {
  select: string[] | null;
  filters: Filter[];
  sort: Sort[];
  page: number;
  limit: number;
  aggregates: Agg[];
};

export type QueryError = { param: string; message: string };

// ── Parse + validate ─────────────────────────────────────────────────────────

export function parseListQuery(
  sp: URLSearchParams,
  fields: QueryableField[]
): { ok: true; query: ParsedQuery } | { ok: false; errors: QueryError[] } {
  const errors: QueryError[] = [];
  const byPath = new Map(fields.map((f) => [f.path, f]));
  const accepted = fields.map((f) => f.path).join(", ");
  const known = (path: string, param: string): boolean => {
    if (byPath.has(path)) return true;
    errors.push({ param, message: `Unknown field "${path}". Queryable fields: ${accepted}` });
    return false;
  };

  // select
  let select: string[] | null = null;
  const selectRaw = sp.get("select");
  if (selectRaw) {
    select = selectRaw.split(",").map((s) => s.trim()).filter(Boolean);
    for (const p of select) known(p, "select");
  }

  // sort
  const sort: Sort[] = [];
  const sortRaw = sp.get("sort");
  if (sortRaw) {
    for (const raw of sortRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const dir = raw.startsWith("-") ? "desc" : "asc";
      const path = raw.replace(/^[-+]/, "");
      if (known(path, "sort")) sort.push({ path, dir });
    }
  }

  // filter -- ";"-separated field:op:value triples
  const filters: Filter[] = [];
  const filterRaw = sp.get("filter");
  if (filterRaw) {
    for (const clause of filterRaw.split(";").map((s) => s.trim()).filter(Boolean)) {
      const first = clause.indexOf(":");
      const second = clause.indexOf(":", first + 1);
      if (first < 0 || second < 0) {
        errors.push({ param: "filter", message: `Malformed clause "${clause}". Use field:op:value (e.g. status:eq:draft).` });
        continue;
      }
      const path = clause.slice(0, first).trim();
      const op = clause.slice(first + 1, second).trim() as FilterOp;
      const rawValue = clause.slice(second + 1);
      if (!OPS.includes(op)) {
        errors.push({ param: "filter", message: `Unknown operator "${op}". Operators: ${OPS.join(", ")}.` });
        continue;
      }
      if (!known(path, "filter")) continue;
      const field = byPath.get(path)!;
      const value = coerceFilterValue(op, rawValue, field, errors);
      if (value !== INVALID) filters.push({ path, op, value });
    }
  }
  // Also fold simple back-compat params (e.g. ?status=draft) is done by the route.

  // aggregate
  const aggregates: Agg[] = [];
  const aggRaw = sp.get("aggregate");
  if (aggRaw) {
    for (const raw of aggRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const [fn, path] = raw.split(":").map((s) => s.trim()) as [AggFn, string?];
      if (!AGG_FNS.includes(fn)) {
        errors.push({ param: "aggregate", message: `Unknown function "${fn}". Functions: ${AGG_FNS.join(", ")}.` });
        continue;
      }
      if (fn === "count") { aggregates.push({ fn }); continue; }
      if (!path) { errors.push({ param: "aggregate", message: `${fn} needs a field, e.g. ${fn}:total.` }); continue; }
      if (!known(path, "aggregate")) continue;
      if (byPath.get(path)!.type !== "number") { errors.push({ param: "aggregate", message: `${fn}:${path} needs a numeric field.` }); continue; }
      aggregates.push({ fn, path });
    }
  }

  // pagination
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const rawLimit = parseInt(sp.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));

  if (errors.length) return { ok: false, errors };
  return { ok: true, query: { select, filters, sort, page, limit, aggregates } };
}

const INVALID = Symbol("invalid");

function coerceFilterValue(op: FilterOp, raw: string, field: QueryableField, errors: QueryError[]): unknown {
  if (op === "isnull") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    errors.push({ param: "filter", message: `isnull takes true or false, got "${raw}".` });
    return INVALID;
  }
  if (op === "in") {
    return raw.split(",").map((v) => coerceScalar(v.trim(), field, errors)).filter((v) => v !== INVALID);
  }
  return coerceScalar(raw, field, errors);
}

function coerceScalar(raw: string, field: QueryableField, errors: QueryError[]): unknown {
  if (field.type === "number") {
    const n = Number(raw);
    if (Number.isNaN(n)) { errors.push({ param: "filter", message: `"${raw}" is not a number for ${field.path}.` }); return INVALID; }
    return n;
  }
  if (field.type === "boolean") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    errors.push({ param: "filter", message: `"${raw}" is not a boolean for ${field.path}.` });
    return INVALID;
  }
  return raw; // string / date compared lexically (ISO dates sort correctly)
}

// ── Apply ──────────────────────────────────────────────────────────────────

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

function matches(row: unknown, f: Filter): boolean {
  const v = getPath(row, f.path);
  switch (f.op) {
    case "eq":  return v === f.value;
    case "ne":  return v !== f.value;
    case "gt":  return v != null && (v as number | string) > (f.value as number | string);
    case "gte": return v != null && (v as number | string) >= (f.value as number | string);
    case "lt":  return v != null && (v as number | string) < (f.value as number | string);
    case "lte": return v != null && (v as number | string) <= (f.value as number | string);
    case "like": return typeof v === "string" && v.toLowerCase().includes(String(f.value).toLowerCase());
    case "in":  return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
    case "isnull": return (v == null) === (f.value === true);
    default: return false;
  }
}

function project(row: Record<string, unknown>, select: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of select) {
    const val = getPath(row, path);
    if (path.includes(".")) {
      const [head, ...rest] = path.split(".");
      const nested = (out[head] as Record<string, unknown>) ?? {};
      let cur = nested;
      for (let i = 0; i < rest.length - 1; i++) cur = (cur[rest[i]] = (cur[rest[i]] as Record<string, unknown>) ?? {});
      cur[rest[rest.length - 1]] = val;
      out[head] = nested;
    } else {
      out[path] = val;
    }
  }
  return out;
}

export type ListResult<T> = {
  data: T[];
  meta: {
    count: number;      // rows on this page
    total: number;      // rows after filtering (before pagination)
    page: number;
    limit: number;
    has_more: boolean;
    aggregates?: Record<string, number>;
  };
  links: { next: Record<string, string> | null; prev: Record<string, string> | null };
};

export function applyListQuery<T extends Record<string, unknown>>(
  rows: T[],
  query: ParsedQuery
): ListResult<T> {
  // filter (AND)
  let filtered = query.filters.length ? rows.filter((r) => query.filters.every((f) => matches(r, f))) : rows;

  // aggregates over the filtered set (before pagination)
  let aggregates: Record<string, number> | undefined;
  if (query.aggregates.length) {
    aggregates = {};
    for (const a of query.aggregates) {
      if (a.fn === "count") { aggregates["count"] = filtered.length; continue; }
      const nums = filtered.map((r) => getPath(r, a.path!)).filter((v): v is number => typeof v === "number");
      const key = `${a.fn}_${a.path}`;
      if (a.fn === "sum") aggregates[key] = nums.reduce((s, n) => s + n, 0);
      else if (a.fn === "avg") aggregates[key] = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
      else if (a.fn === "min") aggregates[key] = nums.length ? Math.min(...nums) : 0;
      else if (a.fn === "max") aggregates[key] = nums.length ? Math.max(...nums) : 0;
    }
  }

  // sort (stable multi-key)
  if (query.sort.length) {
    filtered = [...filtered].sort((a, b) => {
      for (const s of query.sort) {
        const av = getPath(a, s.path) as number | string | null | undefined;
        const bv = getPath(b, s.path) as number | string | null | undefined;
        if (av == null && bv == null) continue;
        if (av == null) return s.dir === "asc" ? -1 : 1;
        if (bv == null) return s.dir === "asc" ? 1 : -1;
        if (av < bv) return s.dir === "asc" ? -1 : 1;
        if (av > bv) return s.dir === "asc" ? 1 : -1;
      }
      return 0;
    });
  }

  const total = filtered.length;
  const start = (query.page - 1) * query.limit;
  const pageRows = filtered.slice(start, start + query.limit);
  const has_more = start + query.limit < total;

  const projected = query.select
    ? (pageRows.map((r) => project(r, query.select!)) as T[])
    : pageRows;

  return {
    data: projected,
    meta: { count: projected.length, total, page: query.page, limit: query.limit, has_more, aggregates },
    links: {
      next: has_more ? { page: String(query.page + 1), limit: String(query.limit) } : null,
      prev: query.page > 1 ? { page: String(query.page - 1), limit: String(query.limit) } : null,
    },
  };
}
