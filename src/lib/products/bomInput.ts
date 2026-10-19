import { roundHalfAway } from "@/lib/products/bom";

// Validation of a BOM line coming from a request body, a form or a
// Data Workbench row. Pure, so every surface applies the same limits (the
// column limits are numeric(14,4) for qty, numeric(6,2) for scrap).

export type BomLineFields = {
  qty?: number;
  uom?: string | null;
  scrap_pct?: number;
  line_kind?: "consumed" | "used";
  note?: string | null;
  sort_order?: number;
};

export type BomLineParse = { ok: true; fields: BomLineFields } | { ok: false; message: string };

const MAX_QTY = 9_999_999_999;

function numberOf(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Fields present in `body` are validated; absent ones are left out. With
 *  `requireQty` (a create) a missing quantity is an error. */
export function parseBomLineInput(body: Record<string, unknown>, opts: { requireQty?: boolean } = {}): BomLineParse {
  const fields: BomLineFields = {};

  if ("qty" in body || opts.requireQty) {
    const qty = numberOf(body.qty);
    if (qty === null || qty <= 0) return { ok: false, message: "Quantity must be a number above zero" };
    if (qty > MAX_QTY) return { ok: false, message: "Quantity is too large" };
    fields.qty = roundHalfAway(qty, 4);
  }
  if ("scrap_pct" in body) {
    const raw = body.scrap_pct;
    const scrap = raw === null || raw === "" ? 0 : numberOf(raw);
    if (scrap === null || scrap < 0 || scrap > 100) return { ok: false, message: "Scrap must be between 0 and 100 percent" };
    fields.scrap_pct = roundHalfAway(scrap, 2);
  }
  if ("line_kind" in body) {
    if (body.line_kind !== "consumed" && body.line_kind !== "used") return { ok: false, message: "Kind must be consumed or used" };
    fields.line_kind = body.line_kind;
  }
  if ("uom" in body) {
    if (body.uom !== null && typeof body.uom !== "string") return { ok: false, message: "Unit must be text" };
    const uom = (body.uom ?? "").trim();
    if (uom.length > 20) return { ok: false, message: "Unit can be at most 20 characters" };
    fields.uom = uom || null;
  }
  if ("note" in body) {
    if (body.note !== null && typeof body.note !== "string") return { ok: false, message: "Note must be text" };
    const note = (body.note ?? "").trim();
    if (note.length > 500) return { ok: false, message: "Note can be at most 500 characters" };
    fields.note = note || null;
  }
  if ("sort_order" in body) {
    const so = numberOf(body.sort_order);
    if (so === null || !Number.isInteger(so) || so < 0 || so > 100000) return { ok: false, message: "Order must be a whole number" };
    fields.sort_order = so;
  }
  return { ok: true, fields };
}
