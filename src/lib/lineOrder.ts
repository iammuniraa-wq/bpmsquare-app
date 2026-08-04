// `sl_no` is a text column (it has to be — users enter "1", "1a", "2.10"), so a
// plain SQL `order by sl_no` sorts it lexicographically: 1, 10, 11, 2, 3.
// These helpers restore the numeric ordering a human expects, chunk by chunk,
// so "2.10" still sorts after "2.9" and "1a" after "1".

const CHUNKS = /(\d+)|(\D+)/g;

export function compareSlNo(a: string | null | undefined, b: string | null | undefined): number {
  // Unnumbered lines keep their existing position at the end, matching the
  // NULLS LAST that the SQL ordering already produced.
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const ac = a.match(CHUNKS) ?? [];
  const bc = b.match(CHUNKS) ?? [];

  for (let i = 0; i < Math.min(ac.length, bc.length); i++) {
    const x = ac[i], y = bc[i];
    const xNum = /^\d/.test(x), yNum = /^\d/.test(y);
    if (xNum && yNum) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d !== 0) return d;
    } else {
      const d = x.localeCompare(y, undefined, { sensitivity: "base" });
      if (d !== 0) return d;
    }
  }
  return ac.length - bc.length;
}

/** Stable natural sort by `sl_no`; input order is preserved for equal keys. */
export function sortBySlNo<T extends { sl_no?: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => compareSlNo(a.sl_no, b.sl_no));
}
