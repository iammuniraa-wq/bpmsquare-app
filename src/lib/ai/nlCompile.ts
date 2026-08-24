import "server-only";

// Shared NL→structured-query compilation pieces, used by both
// POST /api/v1/ask (external API, bearer-key auth) and
// POST /api/reports/ask (in-app "talk to data", session auth). The model
// NEVER writes SQL and never sees a row of data -- it only ever emits this
// structured shape, which is validated by parseListQuery() against the
// object's field whitelist before anything runs. A hallucinated field name
// is a 422, never a query. See docs/ai-report-builder-architecture.md §1.

export const QUERY_OPS = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "in", "isnull"] as const;
export const AGG_FNS = ["count", "sum", "avg", "min", "max"] as const;

export type CompiledQueryInput = {
  filters?: { field: string; op: string; value: string }[];
  search?: string;
  sort?: { field: string; dir: string }[];
  select?: string[];
  aggregates?: { fn: string; field?: string }[];
  group_by?: string;
  /** HAVING: conditions on group aggregates ("sum_total:gt:50000") or count. */
  having?: { key: string; op: string; value: number }[];
  /** Which value orders the groups: "count", "key", or an aggregate key like
   * "sum_total". Descending unless prefixed "+". */
  group_sort?: string;
  limit?: number;
  count_only?: boolean;
};

type FieldLike = { path: string; type: string; searchable?: boolean };

/** The query-shape half of a tool's input_schema.properties -- shared
 * unchanged between /ask and Report Builder's compile stage; each caller
 * adds its own top-level fields (answerable, chart_type, etc.) around it. */
export function baseQueryProperties(fields: FieldLike[]): Record<string, unknown> {
  const paths = fields.map((f) => f.path);
  return {
    filters: {
      type: "array",
      description: "Conditions, ANDed together. Use only listed field paths.",
      items: {
        type: "object",
        properties: {
          field: { type: "string", enum: paths },
          op: { type: "string", enum: QUERY_OPS, description: "like = case-insensitive contains; in = comma-separated list; isnull value is 'true'/'false'." },
          value: { type: "string", description: "The comparison value as a string (dates as ISO yyyy-mm-dd)." },
        },
        required: ["field", "op", "value"],
      },
    },
    search: { type: "string", description: "Free-text contains across searchable fields (" + fields.filter((f) => f.searchable).map((f) => f.path).join(", ") + "). Use instead of guessing which text field." },
    sort: {
      type: "array",
      items: { type: "object", properties: { field: { type: "string", enum: paths }, dir: { type: "string", enum: ["asc", "desc"] } }, required: ["field", "dir"] },
    },
    select: { type: "array", items: { type: "string", enum: paths }, description: "Fields to return; omit for all." },
    aggregates: {
      type: "array",
      description: "Aggregates over the filtered set, e.g. sum of total.",
      items: { type: "object", properties: { fn: { type: "string", enum: AGG_FNS }, field: { type: "string", enum: paths } }, required: ["fn"] },
    },
    group_by: { type: "string", enum: paths, description: "Group counts/aggregates by this field." },
    having: {
      type: "array",
      description: "Conditions on GROUP-LEVEL values after group_by (SQL HAVING). Use when the threshold applies to the group's total, not individual rows -- e.g. 'accounts with quote value over 50k' = group_by account, aggregate sum:total, having sum_total gt 50000. Keys: 'count' or '<fn>_<field>' of a requested aggregate.",
      items: {
        type: "object",
        properties: {
          key: { type: "string", description: "'count' or an aggregate key like 'sum_total' -- must match a requested aggregate." },
          op: { type: "string", enum: ["eq", "ne", "gt", "gte", "lt", "lte"] },
          value: { type: "number" },
        },
        required: ["key", "op", "value"],
      },
    },
    group_sort: { type: "string", description: "Orders the groups: 'count', 'key' (alphabetical/chronological), or an aggregate key like 'sum_total'. Descending by default; prefix '+' for ascending. For value questions ALWAYS sort by the value aggregate; for time trends use '+key'." },
    limit: { type: "integer", minimum: 1, maximum: 200, description: "Row cap; use with sort for 'top N'." },
    count_only: { type: "boolean", description: "true for 'how many' questions -- returns the count without the rows." },
  };
}

// Build the same wire query string a REST caller would send, so it runs
// through the identical parseListQuery() validation path either caller uses.
export function compiledQueryToSearchParams(q: CompiledQueryInput): URLSearchParams {
  const sp = new URLSearchParams();
  if (q.filters?.length) sp.set("filter", q.filters.map((f) => `${f.field}:${f.op}:${f.value}`).join(";"));
  if (q.search) sp.set("search", q.search);
  if (q.sort?.length) sp.set("sort", q.sort.map((s) => (s.dir === "desc" ? "-" : "") + s.field).join(","));
  if (q.select?.length) sp.set("select", q.select.join(","));
  if (q.aggregates?.length) sp.set("aggregate", q.aggregates.map((a) => (a.field ? `${a.fn}:${a.field}` : a.fn)).join(","));
  if (q.group_by) sp.set("group_by", q.group_by);
  if (q.having?.length) sp.set("having", q.having.map((h) => `${h.key}:${h.op}:${h.value}`).join(";"));
  if (q.group_sort) sp.set("group_sort", q.group_sort);
  if (q.limit) sp.set("limit", String(q.limit));
  if (q.count_only) sp.set("count", "only");
  return sp;
}
