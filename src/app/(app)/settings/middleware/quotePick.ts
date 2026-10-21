import type { AccountChoice, QuoteChoice } from "./api";

// Pick, don't paste an id: the Standard Quote list for Send now and Send a record.

const money = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);

export type QuoteOption = { id: string; label: string; group: "Awarded" | "Rejected" };

/** Awarded and rejected quotes only, awarded first: a draft has nothing to send yet. */
export function quoteOptions(quotes: readonly QuoteChoice[], accounts: readonly AccountChoice[]): QuoteOption[] {
  const name = new Map(accounts.map((a) => [a.id, a.name]));
  const out: QuoteOption[] = [];
  for (const q of quotes) {
    if (q.status !== "accepted" && q.status !== "rejected") continue;
    const who = q.account_id ? name.get(q.account_id) : undefined;
    out.push({ id: q.id, label: `${q.ref}${who ? ` · ${who}` : ""} · ${money(q.total)}`, group: q.status === "accepted" ? "Awarded" : "Rejected" });
  }
  return out.sort((a, b) => (a.group === b.group ? b.label.localeCompare(a.label) : a.group === "Awarded" ? -1 : 1));
}

