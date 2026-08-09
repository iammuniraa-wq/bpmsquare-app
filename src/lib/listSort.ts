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
