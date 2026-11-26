// The estimate to go a project manager types (design decision 3): parsing and the one rule about which rows may be saved. PURE, so the route
// and the tests share it.

export const ETG_LIMITS = { maxEntries: 500, wbs: 100, resource: 40, note: 500, amountMax: 999_999_999_999 } as const;

/** An entry of the request: `amount` null clears the typed estimate (the row goes back to "the budget holds"). */
export type EtgPatch = { wbs_code: string; resource_code: string; amount: number | null; note: string | null };

export type ParsedEtg = { ok: true; entries: EtgPatch[] } | { ok: false; error: string };

const str = (v: unknown, max: number): string | null => (v === undefined || v === null ? "" : typeof v === "string" && v.length <= max ? v.trim() : null);

export function parseEtgEntries(body: unknown): ParsedEtg {
  const raw = body && typeof body === "object" ? (body as { entries?: unknown }).entries : null;
  if (!Array.isArray(raw)) return { ok: false, error: "entries must be a list" };
  if (raw.length === 0) return { ok: false, error: "Nothing to save" };
  if (raw.length > ETG_LIMITS.maxEntries) return { ok: false, error: `Up to ${ETG_LIMITS.maxEntries} rows can be saved at once` };
  const seen = new Set<string>();
  const out: EtgPatch[] = [];
  for (const [i, e] of raw.entries()) {
    const r = (e && typeof e === "object" ? e : null) as Record<string, unknown> | null;
    if (!r) return { ok: false, error: `Row ${i + 1} is not a row` };
    const wbs = str(r.wbs_code, ETG_LIMITS.wbs);
    const resource = str(r.resource_code, ETG_LIMITS.resource);
    if (wbs === null || resource === null) return { ok: false, error: `Row ${i + 1} has a code that is too long` };
    let amount: number | null = null;
    if (r.amount !== null && r.amount !== undefined && r.amount !== "") {
      const n = typeof r.amount === "number" ? r.amount : typeof r.amount === "string" ? Number(r.amount) : Number.NaN;
      if (!Number.isFinite(n) || n < 0 || n > ETG_LIMITS.amountMax) return { ok: false, error: `The estimate in row ${i + 1} must be a number of 0 or more` };
      amount = Math.round(n * 100) / 100;
    }
    const note = r.note === undefined || r.note === null || r.note === "" ? null : typeof r.note === "string" ? r.note.trim().slice(0, ETG_LIMITS.note) : null;
    const key = `${wbs}|${resource}`;
    if (seen.has(key)) return { ok: false, error: "A row appears twice" };
    seen.add(key);
    out.push({ wbs_code: wbs, resource_code: resource, amount, note });
  }
  return { ok: true, entries: out };
}

/**
 * A typed estimate may only sit on a cell the approved budget has (or one that already holds a typed estimate, so a stale row can be
 * cleared). Anything else is refused: a made-up cell would be an Unmapped row nobody can explain.
 */
export function unknownCells(entries: readonly EtgPatch[], known: ReadonlySet<string>): EtgPatch[] {
  return entries.filter((e) => e.amount !== null && !known.has(`${e.wbs_code}|${e.resource_code}`));
}
