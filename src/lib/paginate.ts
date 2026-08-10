// Shared row-count-based pagination, the display-side counterpart to
// listSort.ts's sortRows -- every object list fetches its full tenant
// dataset already (no server-side range/limit anywhere in this product),
// so paging only ever needs to slice an already-in-memory array.

export const DEFAULT_PAGE_SIZE = 20;

export function paginate<T>(rows: T[], page: number, pageSize: number = DEFAULT_PAGE_SIZE): T[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function pageCount(total: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamps a page number into [1, pageCount] -- e.g. after a filter shrinks the result set. */
export function clampPage(page: number, total: number, pageSize: number = DEFAULT_PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCount(total, pageSize));
}
