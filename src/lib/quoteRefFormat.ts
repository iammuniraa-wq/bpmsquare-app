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
