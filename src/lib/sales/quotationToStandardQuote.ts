// Quotation -> Standard Quote has no link column, so the source is the first line of the new quote's notes.
// The same line is what the route looks for to refuse a second copy, so keep it one stable, exact string.

export function sourceQuotationMarker(ref: string): string {
  return `Source quotation: ${ref}.`;
}
