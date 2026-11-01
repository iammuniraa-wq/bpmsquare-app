// Who a holiday applies to: "all", or one or more of the workspace's configured employment types (one wfm_holidays row
// per type). Pure, shared by POST /api/wfm/holidays and its bulk upload.

export type TypeOption = { code: string; label: string };

export type Audience = { codes: string[] } | { error: string };

/** The message when the database still has the old CHECK (migration 0244 not run yet). */
export const HOLIDAY_CHECK_PENDING = "Run migration 0244 to use this type for holidays";

const EVERYONE = new Set(["", "all", "everyone", "everybody"]);

/**
 * `input` is a code, a label, a comma-separated list of them, or an array of codes. A blank value or "all" is everyone.
 * An unknown name is an error rather than a silent "everyone": a typo must not turn a trainee-only holiday into one for
 * the whole company. The one lenient case is a single unknown string from the older single-select form, which keeps the
 * old fallback to everyone.
 */
export function resolveHolidayAudience(input: unknown, types: TypeOption[], lenientScalar = false): Audience {
  const parts: string[] = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === "string")
    : typeof input === "string" ? input.split(/[,;]/) : [];
  const wanted = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (wanted.length === 0) {
    return Array.isArray(input) ? { error: "Choose at least one employment type" } : { codes: ["all"] };
  }
  if (wanted.some((w) => EVERYONE.has(w.toLowerCase()))) return { codes: ["all"] };
  const codes: string[] = [];
  const unknown: string[] = [];
  for (const w of wanted) {
    const lw = w.toLowerCase();
    const hit = types.find((t) => t.code.toLowerCase() === lw || t.label.trim().toLowerCase() === lw);
    if (hit) { if (!codes.includes(hit.code)) codes.push(hit.code); } else unknown.push(w);
  }
  if (unknown.length > 0) {
    if (lenientScalar && typeof input === "string" && wanted.length === 1) return { codes: ["all"] };
    return { error: `Unknown employment type: ${unknown.join(", ")}` };
  }
  return { codes };
}
