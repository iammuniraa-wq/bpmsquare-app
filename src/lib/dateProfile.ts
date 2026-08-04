// Strict parsing for date-profile override fields (0059). Two failure modes
// the naive regex+Date approach had: a regex-shaped but calendar-invalid
// string ("2026-99-99") makes toISOString() throw an unhandled RangeError
// (opaque 500), and JS Date silently rolls impossible dates over
// ("2026-02-31" -> Mar 3) -- so validity is checked by round-tripping the
// parsed date back to its string. null/"" means "clear the value"
// (intentional, the Edit-dates panel does this); anything else malformed is
// rejected so a typo can never silently destroy an existing business
// timestamp.

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseValidDay(v: string): Date | null {
  if (!DATE_ONLY_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  return d;
}

/** For timestamptz columns: valid day -> ISO timestamp at UTC midnight. */
export function parseTimestampOverride(v: unknown): { ok: true; iso: string | null } | { ok: false } {
  if (v === null || v === "") return { ok: true, iso: null };
  if (typeof v !== "string") return { ok: false };
  const d = parseValidDay(v);
  return d ? { ok: true, iso: d.toISOString() } : { ok: false };
}

/** For date columns: valid day -> the date string itself. */
export function parseDateOverride(v: unknown): { ok: true; date: string | null } | { ok: false } {
  if (v === null || v === "") return { ok: true, date: null };
  if (typeof v !== "string") return { ok: false };
  return parseValidDay(v) ? { ok: true, date: v } : { ok: false };
}
