// Global search -- object registry + result shape. Pure and dependency-free
// so it's safe to import from the client (the search bar's "search only in…"
// object picker) and the server (the query executor in lib/data/live.ts),
// same split as lib/marketingSegmentation.ts.

export type SearchObjectType =
  | "account" | "contact" | "asset" | "case" | "quote"
  | "work_order" | "purchase_order" | "invoice" | "inventory_item"
  | "supplier" | "lead";

export type SearchObjectDef = {
  type: SearchObjectType;
  label: string;
  icon: string;
};

/** Order here is the order results are grouped in when searching "All
 * objects". Adding a new searchable object means one entry here plus one
 * ObjectQuerySpec in lib/data/live.ts's globalSearchLive(). */
export const SEARCH_OBJECTS: SearchObjectDef[] = [
  { type: "account", label: "Accounts", icon: "▣" },
  { type: "contact", label: "Contacts", icon: "◉" },
  { type: "case", label: "Cases", icon: "☎" },
  { type: "quote", label: "Quotations", icon: "₹" },
  { type: "work_order", label: "Work Orders", icon: "▦" },
  { type: "invoice", label: "Invoices", icon: "▥" },
  { type: "purchase_order", label: "Purchase Orders", icon: "▤" },
  { type: "asset", label: "Assets", icon: "⚙" },
  { type: "inventory_item", label: "Inventory", icon: "▧" },
  { type: "supplier", label: "Suppliers", icon: "⌂" },
  { type: "lead", label: "Leads", icon: "✦" },
];

export function getSearchObject(type: string): SearchObjectDef | undefined {
  return SEARCH_OBJECTS.find((o) => o.type === type);
}

export type SearchResult = {
  type: SearchObjectType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  /** Which field matched -- shown as a small hint, e.g. "phone" for a PII
   * fallback match that wouldn't otherwise be obvious from title/subtitle. */
  matched: string;
};
