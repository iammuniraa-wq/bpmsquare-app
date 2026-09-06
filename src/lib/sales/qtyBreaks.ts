// A product's own quantity breaks (0118): the quantities at which it is
// offered at another rate, kept on the product locally or synced from the
// ERP. Offered by the Standard Quote add-line panel; a break with no rate
// is priced the normal way (engine or list price) at that quantity.

export type QtyBreak = { from: number; rate: number | null };

/** Well-formed breaks only, ascending, de-duplicated by quantity; a
 *  quantity of 1 or less is dropped (that is the base quantity). */
export function parseQtyBreaks(raw: unknown): QtyBreak[] {
  if (!Array.isArray(raw)) return [];
  const byQty = new Map<number, QtyBreak>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const from = typeof o.from === "number" ? o.from : parseFloat(String(o.from ?? ""));
    if (!Number.isFinite(from) || from <= 1) continue;
    const rateRaw = o.rate === null || o.rate === undefined || o.rate === "" ? null : (typeof o.rate === "number" ? o.rate : parseFloat(String(o.rate)));
    const rate = rateRaw !== null && Number.isFinite(rateRaw) && rateRaw >= 0 ? rateRaw : null;
    byQty.set(from, { from, rate });
  }
  return [...byQty.values()].sort((a, b) => a.from - b.from);
}
