import type { QuoteIdFormat } from "./constants";

/**
 * Pure token substitution — no DB access, safe to import from client components
 * (e.g. the Settings live-preview) as well as server code.
 * Supported tokens: {PREFIX} {YYYY} {YY} {MM} {SEQ}
 */
export function formatQuoteRef(fmt: QuoteIdFormat, date: Date, seq: number): string {
  const yyyy = String(date.getFullYear());
  const yy = yyyy.slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const seqStr = String(seq).padStart(fmt.seq_digits, "0");

  return fmt.template
    .replaceAll("{PREFIX}", fmt.prefix)
    .replaceAll("{YYYY}", yyyy)
    .replaceAll("{YY}", yy)
    .replaceAll("{MM}", mm)
    .replaceAll("{SEQ}", seqStr);
}

const BAD_CHARS = /[<>"'\\\r\n]/;

/** A stored or posted number pattern, checked: it must contain {SEQ}, be short, and use only the known tokens plus plain
 *  text. null = not a usable pattern (the caller keeps its fixed format). */
export function sanitizeIdFormat(raw: unknown): QuoteIdFormat | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const template = typeof r.template === "string" ? r.template.trim() : "";
  if (!template.includes("{SEQ}") || template.length > 40) return null;
  if (/\{(?!PREFIX\}|YYYY\}|YY\}|MM\}|SEQ\})/.test(template) || BAD_CHARS.test(template)) return null;
  const prefix = typeof r.prefix === "string" ? r.prefix.trim().slice(0, 12) : "";
  if (BAD_CHARS.test(prefix) || /[{}]/.test(prefix)) return null;
  const digits = Number(r.seq_digits);
  return {
    template,
    prefix,
    seq_digits: Number.isInteger(digits) && digits >= 2 && digits <= 6 ? digits : 4,
    reset: r.reset === "never" ? "never" : "yearly",
  };
}
