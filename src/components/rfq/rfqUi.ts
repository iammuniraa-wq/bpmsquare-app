import type { PillarKey } from "@/lib/theme";
import { c } from "@/lib/theme";
import type { RfqStatus, RfqSupplierStatus } from "@/lib/rfq/types";

// Shared look for the RFQ screens -- one place for the status colours and
// the form controls, so the list, the detail page and the create dialog read
// as one object.

export const RFQ_STATUS_TONE: Record<RfqStatus, PillarKey> = {
  draft: "purple",
  sent: "blue",
  partially_replied: "amber",
  replied: "teal",
  awarded: "green",
  closed: "green",
  cancelled: "red",
};

export const SUPPLIER_STATUS_TONE: Record<RfqSupplierStatus, PillarKey> = {
  pending: "purple",
  sent: "blue",
  viewed: "blue",
  replied: "green",
  declined: "red",
  expired: "amber",
  cancelled: "red",
};

export const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7,
  border: `1px solid ${c.line}`, fontSize: 13, background: c.panel, color: c.ink, outline: "none", fontFamily: "inherit",
};

export const lbl: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: c.hint, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4, display: "block",
};

export const btnPrimary: React.CSSProperties = {
  padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600, background: c.accent, color: "#fff", border: "none", cursor: "pointer",
};

export const btnGhost: React.CSSProperties = {
  padding: "7px 13px", borderRadius: 7, fontSize: 12.5, fontWeight: 600, background: c.panel, color: c.ink, border: `1px solid ${c.line}`, cursor: "pointer",
};

export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s.length === 10 ? `${s}T00:00:00` : s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

export const fmtDateTime = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

export function fmtMoney(n: number | null | undefined, currency?: string | null): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
  const v = Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return currency ? `${v} ${currency}` : v;
}
