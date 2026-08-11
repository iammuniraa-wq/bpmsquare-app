// Generic column-sort helpers, shared by every object list page. Column
// sorting doesn't exist anywhere else in this product (the one prior
// instance, in Reports, is a one-off tied to that page) -- this is the
// first reusable version, so every list adopts the same URL param shape
// (`?sort=<key>&dir=asc|desc`) and the same clickable-header affordance.

export type SortExtractor<T> = (row: T) => string | number | null | undefined;

export type SortDir = "asc" | "desc";

/** Reads `sort`/`dir` off a page's awaited searchParams, typed narrowly. */
export function readSortParams(searchParams: { sort?: string; dir?: string }): {
  sort: string | undefined;
  dir: SortDir;
} {
  return { sort: searchParams.sort, dir: searchParams.dir === "desc" ? "desc" : "asc" };
}

/**
 * Sorts `rows` by the extractor registered under `sortKey`. A missing or
 * unrecognized `sortKey` returns `rows` unchanged (its natural/default
 * order) rather than throwing -- an old bookmarked/shared URL with a
 * since-removed sort key should degrade gracefully, not error.
 */
export function sortRows<T>(
  rows: T[],
  sortKey: string | undefined,
  dir: SortDir | undefined,
  extractors: Record<string, SortExtractor<T>>
): T[] {
  if (!sortKey || !extractors[sortKey]) return rows;
  const extract = extractors[sortKey];
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = extract(a);
    const bv = extract(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // nulls sort last regardless of direction
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  });
}

// ── Column search (C4C-style) helpers ────────────────────────────────────────
// Shared by the client tables (state-driven, see components/ColSearch.tsx)
// and the server-rendered tables (URL-param-driven: `cf_<columnId>=<term>`).

const COL_FILTER_PREFIX = "cf_";

/** AND-combine every active column filter, matching against the same value
 * the column sorts by. */
export function applyColFilters<T>(
  rows: T[],
  colFilters: Record<string, string>,
  extractors: Record<string, SortExtractor<T>>
): T[] {
  const entries = Object.entries(colFilters).filter(([, term]) => term.trim() !== "");
  if (entries.length === 0) return rows;
  return rows.filter((r) =>
    entries.every(([colId, term]) => {
      const ex = extractors[colId];
      if (!ex) return true;
      return String(ex(r) ?? "").toLowerCase().includes(term.trim().toLowerCase());
    })
  );
}

/** Pull cf_<col> params out of a page's searchParams record. */
export function parseColFilterParams(params: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k.startsWith(COL_FILTER_PREFIX) && typeof v === "string" && v.trim() !== "") {
      out[k.slice(COL_FILTER_PREFIX.length)] = v;
    }
  }
  return out;
}

/** Back to cf_-prefixed form, for hiddenParams spreads (so sorting, paging
 * and the quick-filter form all preserve active column filters). */
export function colFilterQueryParams(colFilters: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(colFilters).map(([k, v]) => [COL_FILTER_PREFIX + k, v]));
}
