import type { DocumentView, EntitySchedule, SyncEntity } from "./api";

// The Links table: one row per object-to-object link. BPMSquare | arrow | ERP | Runs | On.
// Outbound (Standard Quote -> the ERP document) and inbound (an ERP entity -> a BPMSquare object).

export type LinkRow = {
  id: string;
  kind: "out" | "in";
  bpm: string;
  erp: string;
  runs: string;
  enabled: boolean;
  /** Outbound only: the document the panel edits. */
  doc?: DocumentView;
  /** Inbound only: the entity whose On switch this row holds. */
  entity?: SyncEntity;
  /** The row cannot be switched on yet (a database update is pending); `runs` says so. */
  blocked?: boolean;
};

/** The inbound links offered, in order: ERP entity key -> the BPMSquare object it fills and the ERP's own word. */
export const INBOUND_LINKS: { key: string; bpm: string; erp: string }[] = [
  { key: "customers", bpm: "Accounts", erp: "Customers" },
  { key: "contacts", bpm: "Contacts", erp: "Contacts" },
  { key: "products", bpm: "Products", erp: "Products" },
  { key: "projects", bpm: "Projects", erp: "Projects" },
  // Dynamics 365 Sales only: the entity is not listed for other products, so the row does not appear for them.
  { key: "sales_orders", bpm: "Sales orders", erp: "Sales orders" },
];

export const SCHEDULE_WORD: Record<EntitySchedule, string> = { off: "Off", hourly: "Hourly", daily: "Daily" };

/** The BPMSquare side of an outbound document: the object it comes from, not the word "Quote" the ERP uses. */
const sourceWord = (d: DocumentView): string => (d.source === "standard_quote" || d.key === "quote" ? "Standard Quote" : d.label);

/** What SAP S/4HANA fills: customers and suppliers become accounts and suppliers, products stay products. */
export const SAP_INBOUND_LINKS: { key: string; bpm: string; erp: string }[] = [
  { key: "customers", bpm: "Accounts", erp: "Customers" },
  { key: "vendors", bpm: "Suppliers", erp: "Suppliers" },
  { key: "products", bpm: "Products", erp: "Products" },
];

export function buildLinks(documents: readonly DocumentView[], entities: readonly SyncEntity[], inbound: readonly { key: string; bpm: string; erp: string }[] = INBOUND_LINKS): LinkRow[] {
  const out: LinkRow[] = documents.map((d) => ({
    id: `out:${d.key}`, kind: "out", bpm: sourceWord(d), erp: d.target.label || "—", runs: "When awarded", enabled: d.enabled, doc: d,
  }));
  const inn: LinkRow[] = inbound.flatMap((l) => {
    const e = entities.find((x) => x.key === l.key);
    return e ? [{ id: `in:${l.key}`, kind: "in" as const, bpm: l.bpm, erp: l.erp, runs: e.blocked ? "Database update needed" : SCHEDULE_WORD[e.schedule] ?? "Off", enabled: e.enabled, entity: e, blocked: !!e.blocked }] : [];
  });
  return [...out, ...inn];
}
