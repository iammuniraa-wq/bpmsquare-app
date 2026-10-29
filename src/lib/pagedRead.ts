/**
 * PostgREST answers at most 1000 rows per request: a `.limit(2000)` is silently cut to 1000, so a reader that feeds an aggregate, an
 * export, a cron or a "load everything then filter in JS" step loses rows without any error. This reads a query page by page until a
 * short page ends it. The caller passes the query *with a stable `.order(...)`* (a unique column, or the sort followed by `id`) and the
 * helper adds `.range(from, to)`, so no row is skipped or repeated between pages. Same house pattern as `fetchAllRows`
 * (src/lib/import/server.ts), for queries that carry more filters than "everything of one tenant".
 */

export const PAGE_SIZE = 1000;
/** A runaway guard, not a business limit: 200 pages of 1000. */
const DEFAULT_MAX_ROWS = 200_000;

export type PgError = { code?: string; message: string } | null;
type Page = { data: unknown; error: PgError };

// `any` rows on purpose: the Supabase client here is untyped, so a drop-in for `await query` must hand back what `data` was.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readAllPages<T = any>(
  run: (from: number, to: number) => PromiseLike<Page>,
  opts: { maxRows?: number } = {},
): Promise<{ data: T[] | null; error: PgError }> {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error };
    const got = (data ?? []) as T[];
    rows.push(...got);
    if (got.length < PAGE_SIZE) break;
  }
  return { data: rows, error: null };
}
