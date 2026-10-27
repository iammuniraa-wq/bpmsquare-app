// A Standard Quote line's sl_no is 1..n for an ordinary quote. A quote made from a tender bid version stores the CLIENT's item number
// there instead ("1.1", "A-3", "12"), and that number is what the client reads back on the quote and the PDF.

type Numbered = { sl_no?: string | null };

/**
 * True when the lines carry item numbers other than a plain 1..n running count, i.e. numbers the client (or an import) supplied.
 * Order does not matter: a quote whose lines are 1..n in any order, or that has no numbers at all, is an ordinary one.
 */
export function hasClientItemNumbers(lines: Numbered[]): boolean {
  const values = lines.map((l) => (l.sl_no ?? "").trim()).filter(Boolean);
  if (values.length === 0) return false;
  if (values.length !== lines.length || new Set(values).size !== values.length) return true;
  return values.some((v) => !/^[1-9]\d*$/.test(v) || Number(v) > lines.length);
}

/** The number to show for a line: the stored one when the quote carries client numbers, otherwise the running position. */
export function itemNumber(line: Numbered, position: number, clientNumbers: boolean): string {
  return clientNumbers ? (line.sl_no ?? "").trim() || String(position) : String(position);
}
