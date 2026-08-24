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
export type QueryableField = {
  path: string; type: QueryableType; searchable?: boolean;
  /** PII/sensitive (e.g. email, phone, salary). Never a v1-API restriction on
   * its own -- routes that need field-level PII policy (Report Builder's
   * table vs aggregate rule, see docs/ai-report-builder-architecture.md §3.7)
   * read this; it does not change what select/filter/sort already allow. */
  sensitive?: boolean;
};

export type FilterOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "like" | "in" | "isnull";
const OPS: readonly FilterOp[] = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "in", "isnull"];

export type AggFn = "count" | "sum" | "avg" | "min" | "max";
const AGG_FNS: readonly AggFn[] = ["count", "sum", "avg", "min", "max"];

export type GroupPeriod = "day" | "week" | "month" | "quarter" | "year";
const GROUP_PERIODS: readonly GroupPeriod[] = ["day", "week", "month", "quarter", "year"];

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
  /** ?search=term across the entity's `searchable` fields (OR-contains). */
  search: { term: string; fields: string[] } | null;
  /** ?group_by=field -> aggregates computed per distinct value, in meta.groups. */
  groupBy: string | null;
  /** ?group_period=month -> bucket a DATE group_by into calendar periods
   * (day|week|month|quarter|year) instead of grouping raw values. Raw
   * timestamps are near-unique, so an unbucketed date group_by produces one
   * group per row -- a broken trend chart. When group_by targets a
   * date-typed field and no period is given, the engine defaults to month
   * (engine is truth: an unbucketed date grouping is never what anyone
   * means). Ignored -- with a validation error -- on non-date fields. */
  groupPeriod: GroupPeriod | null;
  /** ?group_limit=N -> top-N groups by count, the rest collapsed into one
   * "Other" bucket. Unbounded group_by on a high-cardinality field (e.g.
   * account name on a large tenant) is both a payload-size problem and an
   * unreadable chart -- this caps it at the engine level so every consumer
   * of group_by gets the protection, not just chart-rendering callers. */
  groupLimit: number | null;
  /** ?having=sum_total:gt:50000 -> filter GROUPS by an aggregate value (or
   * "count") after group_by -- SQL HAVING semantics. "Accounts whose quote
   * value exceeds 50k" is a condition on the group's sum, not on any single
   * row; without this the only expressible query filters individual rows,
   * which answers a subtly different question. Applied before group_limit. */
  having: { key: string; op: FilterOp; value: number }[];
  /** ?group_sort=sum_total (or "count", or "-key") -> which value orders the
   * groups. Default remains count desc; a value-based question should sort
   * by its own aggregate so the chart reads biggest-first. */
  groupSort: { key: string; dir: "asc" | "desc" } | null;
  /** ?count=only -> return meta only, no data rows. */
  countOnly: boolean;
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

  // search -- OR-contains across the entity's searchable fields
  let search: { term: string; fields: string[] } | null = null;
  const searchRaw = sp.get("search");
  if (searchRaw && searchRaw.trim()) {
    const searchable = fields.filter((f) => f.searchable).map((f) => f.path);
    if (searchable.length === 0) {
      errors.push({ param: "search", message: "This entity has no searchable fields; use filter=... instead." });
    } else {
      search = { term: searchRaw.trim(), fields: searchable };
    }
  }

  // group_by -- aggregate per distinct value of a field
  let groupBy: string | null = null;
  const groupRaw = sp.get("group_by");
  if (groupRaw) {
    if (known(groupRaw.trim(), "group_by")) groupBy = groupRaw.trim();
  }

  // group_period -- calendar bucketing for date group_by (see ParsedQuery).
  let groupPeriod: GroupPeriod | null = null;
  const groupPeriodRaw = sp.get("group_period");
  const groupByIsDate = !!groupBy && byPath.get(groupBy)?.type === "date";
  if (groupPeriodRaw) {
    const p = groupPeriodRaw.trim() as GroupPeriod;
    if (!GROUP_PERIODS.includes(p)) {
      errors.push({ param: "group_period", message: `group_period must be one of: ${GROUP_PERIODS.join(", ")}.` });
    } else if (!groupBy) {
      errors.push({ param: "group_period", message: "group_period requires group_by." });
    } else if (!groupByIsDate) {
      errors.push({ param: "group_period", message: `group_period only applies when group_by targets a date field -- "${groupBy}" is ${byPath.get(groupBy)?.type}.` });
    } else {
      groupPeriod = p;
    }
  } else if (groupByIsDate) {
    groupPeriod = "month";
  }

  // group_limit -- top-N groups by count, rest collapsed into "Other"
  let groupLimit: number | null = null;
  const groupLimitRaw = sp.get("group_limit");
  if (groupLimitRaw) {
    const n = parseInt(groupLimitRaw, 10);
    if (!Number.isInteger(n) || n < 1) {
      errors.push({ param: "group_limit", message: "group_limit must be a positive integer." });
    } else {
      groupLimit = Math.min(100, n);
    }
  }

  // having -- filter groups by aggregate value or count (HAVING semantics).
  // Keys are aggregate result keys ("sum_total", "avg_total", ...) or "count";
  // validated against the aggregates actually requested so a typo fails loudly.
  const having: { key: string; op: FilterOp; value: number }[] = [];
  const havingRaw = sp.get("having");
  if (havingRaw) {
    const validKeys = new Set(["count", ...aggregates.filter((a) => a.fn !== "count").map((a) => `${a.fn}_${a.path}`)]);
    for (const clause of havingRaw.split(";").map((s) => s.trim()).filter(Boolean)) {
      const [key, op, rawValue] = clause.split(":").map((s) => s.trim());
      if (!key || !op || rawValue === undefined) {
        errors.push({ param: "having", message: `Malformed clause "${clause}". Use key:op:value (e.g. sum_total:gt:50000).` });
        continue;
      }
      if (!OPS.includes(op as FilterOp) || op === "like" || op === "in" || op === "isnull") {
        errors.push({ param: "having", message: `having supports eq, ne, gt, gte, lt, lte -- got "${op}".` });
        continue;
      }
      if (!validKeys.has(key)) {
        errors.push({ param: "having", message: `"${key}" isn't an aggregate in this query. Valid: ${[...validKeys].join(", ")}. Add the aggregate (e.g. aggregate=sum:total) first.` });
        continue;
      }
      const n = Number(rawValue);
      if (Number.isNaN(n)) { errors.push({ param: "having", message: `"${rawValue}" is not a number.` }); continue; }
      having.push({ key, op: op as FilterOp, value: n });
    }
    if (having.length > 0 && !sp.get("group_by")) {
      errors.push({ param: "having", message: "having requires group_by." });
    }
  }

  // group_sort -- which value orders the groups (default: count desc)
  let groupSort: { key: string; dir: "asc" | "desc" } | null = null;
  const groupSortRaw = sp.get("group_sort");
  if (groupSortRaw) {
    const dir = groupSortRaw.startsWith("-") ? "desc" : groupSortRaw.startsWith("+") ? "asc" : "desc";
    const key = groupSortRaw.replace(/^[-+]/, "").trim();
    const validKeys = new Set(["count", "key", ...aggregates.filter((a) => a.fn !== "count").map((a) => `${a.fn}_${a.path}`)]);
    if (!validKeys.has(key)) {
      errors.push({ param: "group_sort", message: `"${key}" isn't sortable here. Valid: ${[...validKeys].join(", ")}.` });
    } else {
      groupSort = { key, dir };
    }
  }

  // count=only -> meta only
  const countOnly = sp.get("count") === "only";

  // pagination
  const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);
  const rawLimit = parseInt(sp.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));

  if (errors.length) return { ok: false, errors };
  return { ok: true, query: { select, filters, sort, page, limit, aggregates, search, groupBy, groupPeriod, groupLimit, having, groupSort, countOnly } };
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

export type GroupResult = { key: unknown; count: number; [aggregate: string]: unknown };

export type ListResult<T> = {
  data: T[];
  meta: {
    count: number;      // rows on this page
    total: number;      // rows after filtering (before pagination)
    page: number;
    limit: number;
    has_more: boolean;
    aggregates?: Record<string, number>;
    groups?: GroupResult[];
  };
  links: { next: Record<string, string> | null; prev: Record<string, string> | null };
};

/** Bucket a date/timestamp value into its calendar period key. Keys are
 * chosen so plain lexicographic sort IS chronological sort ("2026-08",
 * "2026-Q3", "2026-W34" all order correctly as strings), which is what
 * group_sort=+key already does. An unparsable value falls through to null
 * so junk dates group under "(none)" instead of throwing. */
function truncateToPeriod(raw: unknown, period: GroupPeriod): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  switch (period) {
    case "day": return `${y}-${pad(m)}-${pad(d.getUTCDate())}`;
    case "week": {
      // ISO week number (Thursday-anchored), year taken from that Thursday.
      const t = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
      const dayNum = t.getUTCDay() || 7;
      t.setUTCDate(t.getUTCDate() + 4 - dayNum);
      const isoYear = t.getUTCFullYear();
      const yearStart = new Date(Date.UTC(isoYear, 0, 1));
      const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
      return `${isoYear}-W${pad(week)}`;
    }
    case "month": return `${y}-${pad(m)}`;
    case "quarter": return `${y}-Q${Math.ceil(m / 3)}`;
    case "year": return String(y);
  }
}

function aggregate(rows: Record<string, unknown>[], aggs: Agg[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of aggs) {
    if (a.fn === "count") { out["count"] = rows.length; continue; }
    const nums = rows.map((r) => getPath(r, a.path!)).filter((v): v is number => typeof v === "number");
    const key = `${a.fn}_${a.path}`;
    if (a.fn === "sum") out[key] = nums.reduce((s, n) => s + n, 0);
    else if (a.fn === "avg") out[key] = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
    else if (a.fn === "min") out[key] = nums.length ? Math.min(...nums) : 0;
    else if (a.fn === "max") out[key] = nums.length ? Math.max(...nums) : 0;
  }
  return out;
}

export function applyListQuery<T extends Record<string, unknown>>(
  rows: T[],
  query: ParsedQuery
): ListResult<T> {
  // filter (AND)
  let filtered = query.filters.length ? rows.filter((r) => query.filters.every((f) => matches(r, f))) : rows;

  // search (OR-contains across searchable fields), ANDed with the filters
  if (query.search) {
    const term = query.search.term.toLowerCase();
    filtered = filtered.filter((r) =>
      query.search!.fields.some((p) => {
        const v = getPath(r, p);
        return typeof v === "string" && v.toLowerCase().includes(term);
      })
    );
  }

  // aggregates over the filtered set (before pagination)
  const aggregates = query.aggregates.length ? aggregate(filtered, query.aggregates) : undefined;

  // group_by -> one aggregate row per distinct value (OData $apply/groupby, but
  // usable). Always includes count; adds any requested aggregates per group.
  // A date group_by is bucketed by groupPeriod (parse defaults it to month),
  // so the key is "2026-08", never a raw near-unique timestamp.
  let groups: GroupResult[] | undefined;
  if (query.groupBy) {
    const buckets = new Map<unknown, Record<string, unknown>[]>();
    for (const r of filtered) {
      const raw = getPath(r, query.groupBy);
      const key = query.groupPeriod ? truncateToPeriod(raw, query.groupPeriod) : raw;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(r);
    }
    groups = [...buckets.entries()]
      .map(([key, rs]) => ({ key, count: rs.length, ...aggregate(rs, query.aggregates.filter((a) => a.fn !== "count")) }));

    // having -- drop groups failing the aggregate condition (SQL HAVING).
    // Runs BEFORE group_limit so "Other" never smuggles excluded groups back.
    if (query.having.length) {
      groups = groups.filter((g) =>
        query.having.every((h) => {
          const v = Number(g[h.key] ?? 0);
          switch (h.op) {
            case "eq": return v === h.value;
            case "ne": return v !== h.value;
            case "gt": return v > h.value;
            case "gte": return v >= h.value;
            case "lt": return v < h.value;
            case "lte": return v <= h.value;
            default: return true;
          }
        })
      );
    }

    // group order: explicit group_sort wins; a period-bucketed (date)
    // grouping defaults to chronological, everything else to count desc.
    const gs = query.groupSort ?? (query.groupPeriod ? { key: "key", dir: "asc" as const } : null);
    groups.sort((a, b) => {
      if (!gs) return b.count - a.count;
      if (gs.key === "key") {
        const av = String(a.key ?? ""), bv = String(b.key ?? "");
        return gs.dir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = Number(a[gs.key] ?? 0), bv = Number(b[gs.key] ?? 0);
      return gs.dir === "asc" ? av - bv : bv - av;
    });

    if (query.groupLimit && groups.length > query.groupLimit) {
      // A chronological (date-bucketed, key-asc) series keeps the most
      // RECENT buckets -- trimming from the front would show a trend's
      // oldest months and hide the ones the question is actually about.
      // The collapsed remainder goes FIRST as "Earlier" so the axis still
      // reads left-to-right in time order.
      const chronological = !!query.groupPeriod && gs?.key === "key" && gs.dir === "asc";
      const kept = chronological ? groups.slice(-query.groupLimit) : groups.slice(0, query.groupLimit);
      const rest = chronological ? groups.slice(0, -query.groupLimit) : groups.slice(query.groupLimit);
      const otherRows = rest.flatMap((g) => buckets.get(g.key) ?? []);
      const other = {
        key: chronological ? "Earlier" : "Other",
        count: rest.reduce((s, g) => s + g.count, 0),
        ...aggregate(otherRows, query.aggregates.filter((a) => a.fn !== "count")),
      };
      groups = chronological ? [other, ...kept] : [...kept, other];
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
  // count=only: skip the page slice entirely -- the caller just wants the
  // total / aggregates / groups (cheap "how many match?" without the payload).
  const pageRows = query.countOnly ? [] : filtered.slice(start, start + query.limit);
  const has_more = !query.countOnly && start + query.limit < total;

  const projected = query.select
    ? (pageRows.map((r) => project(r, query.select!)) as T[])
    : pageRows;

  return {
    data: projected,
    meta: { count: projected.length, total, page: query.page, limit: query.limit, has_more, aggregates, groups },
    links: {
      next: has_more ? { page: String(query.page + 1), limit: String(query.limit) } : null,
      prev: query.page > 1 ? { page: String(query.page - 1), limit: String(query.limit) } : null,
    },
  };
}
