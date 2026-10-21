// A product's own price list scales (0118): the quantities at which it is
// offered at another rate, kept on the product or replicated from the ERP.
// The engine reads them as the product's price list (docs/pricing-engine-
// architecture.md §21), the Standard Quote add-line panel offers them as
// alternative rows, and Data Workbench moves them as one text cell.
//
// One parser and one serialiser for every surface, so the registry, the
// product PATCH, import, export, update and the engine cannot drift.
// Pure: no database, no framework imports.

export type QtyBreak = { from: number; rate: number | null };

export const MAX_QTY_BREAKS = 20;

/** The cell format, for the registry description and import errors. */
export const QTY_BREAKS_FORMAT = "from:rate; from:rate, e.g. 100:390; 500:360. Leave a rate blank to price that quantity normally.";

const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
};

/** Tolerant reader for what is already stored (or a loose request body):
 *  well-formed breaks only, ascending, de-duplicated by quantity; a quantity
 *  of 0 or less is dropped. Never throws. Writers use validateQtyBreaks. */
export function parseQtyBreaks(raw: unknown): QtyBreak[] {
  if (!Array.isArray(raw)) return [];
  const byQty = new Map<number, QtyBreak>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const from = toNumber(o.from);
    if (from === null || from <= 0) continue;
    const rateRaw = toNumber(o.rate);
    const rate = rateRaw !== null && rateRaw >= 0 ? rateRaw : null;
    byQty.set(from, { from, rate });
  }
  return [...byQty.values()].sort((a, b) => a.from - b.from);
}

export type QtyBreaksResult = { ok: true; breaks: QtyBreak[] } | { ok: false; error: string };

/** Strict check for anything a person or an integration WRITES: ascending,
 *  no repeated quantity, from > 0, rate >= 0 or blank, at most 20. */
export function validateQtyBreaks(raw: unknown): QtyBreaksResult {
  if (raw === null || raw === undefined) return { ok: true, breaks: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "Quantity breaks must be a list" };
  if (raw.length > MAX_QTY_BREAKS) return { ok: false, error: `At most ${MAX_QTY_BREAKS} quantity breaks` };
  const out: QtyBreak[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") return { ok: false, error: `Break ${i + 1} is not a quantity and a rate` };
    const o = item as Record<string, unknown>;
    const from = toNumber(o.from);
    if (from === null || from <= 0) return { ok: false, error: `Break ${i + 1}: the quantity must be a number above 0` };
    const hasRate = !(o.rate === null || o.rate === undefined || o.rate === "");
    const rate = hasRate ? toNumber(o.rate) : null;
    if (hasRate && (rate === null || rate < 0)) return { ok: false, error: `Break ${i + 1}: the rate must be a number, 0 or more, or blank` };
    if (out.length > 0 && from <= out[out.length - 1].from) {
      return { ok: false, error: `Break ${i + 1}: quantities must go up, each larger than the one before` };
    }
    out.push({ from, rate });
  }
  return { ok: true, breaks: out };
}

/** The cell text for a product's breaks: "100:390; 500:360", a blank rate
 *  as "200:". Empty string when there are none. */
export function serialiseQtyBreaks(raw: unknown): string {
  return parseQtyBreaks(raw).map((b) => `${b.from}:${b.rate === null ? "" : b.rate}`).join("; ");
}

/** Read the cell text back ("100:390; 500:360", blank rate allowed; ";" or
 *  newline between bands). Blank text = no breaks. Validated like any write. */
export function parseQtyBreaksText(text: string | null | undefined): QtyBreaksResult {
  const t = (text ?? "").trim();
  if (!t) return { ok: true, breaks: [] };
  const parts = t.split(/[;\n]/).map((p) => p.trim()).filter(Boolean);
  const rows: { from: string; rate: string }[] = [];
  for (const p of parts) {
    const idx = p.indexOf(":");
    if (idx < 0) return { ok: false, error: `"${p}" is not in the form from:rate (e.g. 100:390)` };
    rows.push({ from: p.slice(0, idx).trim(), rate: p.slice(idx + 1).trim() });
  }
  return validateQtyBreaks(rows);
}
