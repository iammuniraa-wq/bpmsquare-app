// Pure RFQ rules -- no server imports, unit-tested in rules.test.ts. The
// routes and the screens use the same functions so the grid can never show a
// "best" figure the award route would compute differently.

import type { RfqStatus, RfqSupplierStatus, RfqLineStatus, RfqResponseStatus } from "./types";
import { RFQ_LIMITS } from "./types";

/**
 * The header status follows its children once the RFQ has left draft:
 *  - every open line awarded (or no-awarded)  -> awarded
 *  - every live supplier replied/declined     -> replied
 *  - some replied                             -> partially_replied
 *  - otherwise                                -> sent
 * Draft, closed and cancelled are only ever set by hand and are kept.
 */
export function deriveRfqStatus(current: RfqStatus, suppliers: { status: RfqSupplierStatus }[], lines: { status: RfqLineStatus }[]): RfqStatus {
  if (current === "draft" || current === "closed" || current === "cancelled") return current;
  const liveLines = lines.filter((l) => l.status !== "cancelled");
  if (liveLines.length > 0 && liveLines.every((l) => l.status === "awarded" || l.status === "no_award")
      && liveLines.some((l) => l.status === "awarded")) return "awarded";
  const live = suppliers.filter((s) => s.status !== "cancelled" && s.status !== "pending");
  if (live.length === 0) return "sent";
  const answered = live.filter((s) => s.status === "replied" || s.status === "declined");
  if (answered.length === live.length) return "replied";
  if (answered.length > 0) return "partially_replied";
  return "sent";
}

export type ComparableResponse = {
  id: string;
  rfq_supplier_id: string;
  rfq_line_id: string;
  status: RfqResponseStatus;
  unit_price: number | null;
  fx_rate: number | null;
};

/** Unit price in the tenant's currency -- the buyer's FX rate when the
 *  supplier quoted in another currency, 1 when unset. */
export function landedUnit(r: Pick<ComparableResponse, "unit_price" | "fx_rate">): number | null {
  if (r.unit_price === null || !Number.isFinite(Number(r.unit_price))) return null;
  const fx = r.fx_rate === null || !Number.isFinite(Number(r.fx_rate)) || Number(r.fx_rate) <= 0 ? 1 : Number(r.fx_rate);
  return Math.round(Number(r.unit_price) * fx * 10000) / 10000;
}

/** The lowest landed response per line among priced ones -- what the grid
 *  highlights. A no-quote never wins; an alternative can (it is a real
 *  offer, the buyer reads the description). */
export function bestByLine(responses: ComparableResponse[]): Map<string, string> {
  const best = new Map<string, { id: string; v: number }>();
  for (const r of responses) {
    if (r.status === "no_quote") continue;
    const v = landedUnit(r);
    if (v === null || v <= 0) continue;
    const cur = best.get(r.rfq_line_id);
    if (!cur || v < cur.v) best.set(r.rfq_line_id, { id: r.id, v });
  }
  return new Map([...best].map(([k, x]) => [k, x.id]));
}

export type ResponseInput = {
  rfq_line_id: string;
  status?: string;
  unit_price?: unknown;
  currency?: unknown;
  lead_time_days?: unknown;
  moq?: unknown;
  offered_description?: unknown;
  valid_until?: unknown;
  note?: unknown;
};

export type CleanResponse = {
  rfq_line_id: string;
  status: RfqResponseStatus;
  unit_price: number | null;
  currency: string | null;
  lead_time_days: number | null;
  moq: number | null;
  offered_description: string | null;
  valid_until: string | null;
  note: string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown, max: number = RFQ_LIMITS.maxText): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function num(v: unknown, max: number): number | null | "bad" {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(typeof v === "string" ? v.replace(/,/g, "") : v);
  if (!Number.isFinite(n) || n < 0 || n > max) return "bad";
  return n;
}

/**
 * One response row from untrusted input (the public reply page, an uploaded
 * sheet, the buyer's grid). A row with no price and no explicit status is
 * skipped (null), not stored as a zero: an empty cell means "not answered".
 */
export function cleanResponse(input: ResponseInput): { ok: true; value: CleanResponse | null } | { ok: false; error: string } {
  const status: RfqResponseStatus = input.status === "no_quote" ? "no_quote" : input.status === "alternative" ? "alternative" : "quoted";
  const price = num(input.unit_price, RFQ_LIMITS.maxPrice);
  if (price === "bad") return { ok: false, error: "Unit price must be a positive number." };
  if (status !== "no_quote" && price === null) {
    if (input.status === "quoted" || input.status === "alternative") return { ok: false, error: "Enter a unit price, or mark the line as not quoted." };
    return { ok: true, value: null };
  }
  if (status !== "no_quote" && price === 0) return { ok: false, error: "A unit price of zero isn't a quote — mark the line as not quoted instead." };
  const lead = num(input.lead_time_days, 3650);
  if (lead === "bad") return { ok: false, error: "Lead time must be a number of days." };
  const moq = num(input.moq, 1e9);
  if (moq === "bad") return { ok: false, error: "Minimum order must be a positive number." };
  const validUntil = typeof input.valid_until === "string" && DATE_RE.test(input.valid_until.trim()) ? input.valid_until.trim() : null;
  const currencyRaw = text(input.currency, 8);
  const currency = currencyRaw && /^[A-Za-z]{3}$/.test(currencyRaw) ? currencyRaw.toUpperCase() : null;
  return {
    ok: true,
    value: {
      rfq_line_id: input.rfq_line_id,
      status,
      unit_price: status === "no_quote" ? null : (price as number),
      currency,
      lead_time_days: lead === null ? null : Math.round(lead as number),
      moq: moq as number | null,
      offered_description: status === "alternative" ? text(input.offered_description, 1000) : null,
      valid_until: validUntil,
      note: text(input.note, 1000),
    },
  };
}

/** respond_by = today + N days (both YYYY-MM-DD). */
export function addDays(dayKey: string, days: number): string {
  const t = Date.parse(`${dayKey.slice(0, 10)}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** When a reply link stops working: end of respond_by + grace, or 60 days
 *  from now when the RFQ has no deadline. */
export function linkExpiry(respondBy: string | null, graceDays: number, now = Date.now()): number {
  if (respondBy && DATE_RE.test(respondBy)) return Date.parse(`${addDays(respondBy, graceDays)}T23:59:59Z`);
  return now + 60 * 86_400_000;
}

/** "RFQ-0012" from anywhere in a subject line, or null. */
export function refFromSubject(subject: string | null | undefined): string | null {
  const m = /\bRFQ-(\d{1,9})\b/i.exec(subject ?? "");
  return m ? `RFQ-${m[1]}` : null;
}

/** The plain-text part of an HTML body, for storing a reply readably. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Strip the quoted history under a reply ("On ... wrote:" / "-----Original
 *  Message-----" / "> " lines) so the conversation shows what was SAID. The
 *  full text is not lost -- the caller stores what this returns only when
 *  something is left. */
export function stripQuotedReply(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*On .+wrote:\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && out.length > 0 && /^\s*$/.test(out[out.length - 1] ?? "")) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  const t = out.join("\n").trim();
  return t || body.trim();
}
