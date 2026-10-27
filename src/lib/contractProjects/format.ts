// Small, pure display helpers shared by the contract project screens (server and client).

export const money = (n: number | null | undefined, currency?: string | null, digits = 0): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${currency ? `${currency} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

/** A change with its sign always shown ("+SAR 1,200", "-SAR 300"); zero has none. */
export const signedMoney = (n: number | null | undefined, currency?: string | null, digits = 0): string =>
  n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : n < 0 ? "-" : ""}${money(Math.abs(n), currency, digits)}`;

export const pct =(n: number | null | undefined): string => (n === null || n === undefined ? "—" : `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`);

export const day = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** The tone of a status chip: StatusPill's tones. */
export const projectTone = (status: string): "blue" | "amber" | "green" | "red" | "teal" =>
  status === "active" ? "green" : status === "baseline_pending" ? "amber" : status === "closed" ? "teal" : "blue";
