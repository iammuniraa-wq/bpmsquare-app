// How the competitor analysis writes a figure. One spelling, shared by the computation, the plain wording, the check on the model's
// wording and the card, so a number is always written the same way wherever it appears.

export const round = (n: number, d: number): number => { const f = 10 ** d; return Math.round((n + Number.EPSILON) * f) / f; };

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "12", "12.5": never a trailing zero. */
export const pctText = (n: number): string => `${round(n, 1)}%`;

/** "SAR 2M", "SAR 450K", "SAR 900": compact, one decimal at most. */
export function moneyText(n: number, currency: string | null): string {
  const abs = Math.abs(n);
  const body = abs >= 1e9 ? `${round(n / 1e9, 1)}B` : abs >= 1e6 ? `${round(n / 1e6, 1)}M` : abs >= 1e3 ? `${round(n / 1e3, 0)}K` : `${round(n, 0)}`;
  return currency ? `${currency} ${body}` : body;
}
