import { parseListQuery, applyListQuery, type QueryableField } from "@/lib/api/query";
import { jsonOk, jsonValidationError, RW_METHODS } from "./_auth";

type LegacyFilter = { path: string; value: unknown };

/**
 * Shared enriched-list responder for every v1 list endpoint. The route fetches
 * + shapes its rows (tenant-scoped, PII-decrypted), hands them here, and gets
 * the full query layer (select/filter/sort/paginate/aggregate/search/group_by/
 * count) plus a consistent envelope -- with zero query logic per route.
 */
export function enrichedList(
  req: Request,
  rows: Record<string, unknown>[],
  fields: QueryableField[],
  opts: {
    self: string;                 // "/api/v1/accounts"
    metadata?: string;            // "/api/v1/metadata/accounts"
    methods?: string;             // Allow header (defaults to RW_METHODS)
    legacyFilters?: LegacyFilter[]; // back-compat ?status=/?account_id= etc.
    extraMeta?: Record<string, unknown>;
  }
): Response {
  const url = new URL(req.url);
  const parsed = parseListQuery(url.searchParams, fields);
  if (!parsed.ok) return jsonValidationError(parsed.errors.map((e) => ({ field: e.param, message: e.message })));

  const query = parsed.query;
  for (const lf of opts.legacyFilters ?? []) {
    if (lf.value !== null && lf.value !== undefined && lf.value !== "") {
      query.filters.push({ path: lf.path, op: "eq", value: lf.value } as never);
    }
  }

  const result = applyListQuery(rows, query);
  const linkQs = (p: Record<string, string> | null) =>
    p ? `${opts.self}?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), ...p }).toString()}` : null;

  return jsonOk(
    {
      data: result.data,
      meta: { ...result.meta, ...opts.extraMeta, generated_at: new Date().toISOString() },
      _links: {
        self: opts.self,
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
        next: linkQs(result.links.next),
        prev: linkQs(result.links.prev),
      },
    },
    opts.methods ?? RW_METHODS
  );
}
