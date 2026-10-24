import type { D365Config, D365Product } from "@/lib/connectors/d365/types";

// Pure helpers for what a person reads and clicks: product names and deep
// links. The id shown is always the ERP's readable number (QUO-01002, a
// project id); the GUID appears only inside a link.

export const PRODUCT_NAME: Record<D365Product, string> = {
  dataverse: "Dynamics 365 Sales",
  fo: "Dynamics 365 Finance and Operations",
  bc: "Business Central",
};

/** The product as a short word in a one-line summary ("Awarded → Dynamics 365 Quote"). */
export const PRODUCT_SHORT: Record<D365Product, string> = { dataverse: "Dynamics 365", fo: "Finance and Operations", bc: "Business Central" };

/** What an awarded quote becomes in this product. */
export const TARGET_NAME: Record<D365Product, string> = { dataverse: "Quote", fo: "Project", bc: "Project" };

/** Open-in-ERP link for a record, or null where one cannot be built from what we hold. */
export function erpDeepLink(cfg: Pick<D365Config, "product" | "environment_url">, kind: "quote" | "salesorder" | "invoice", erpId: string): string | null {
  if (cfg.product !== "dataverse") return null;
  try {
    const origin = new URL(cfg.environment_url).origin;
    return `${origin}/main.aspx?etn=${kind}&pagetype=entityrecord&id=${encodeURIComponent(erpId)}`;
  } catch {
    return null;
  }
}

export function money(n: number): string {
  return (Math.round(Number(n) * 100) / 100).toFixed(2);
}

/** The header terms a Dataverse quote cannot hold as verified fields, kept as a
 *  readable line in its description so the ERP shows what BPMSquare charged. */
export function totalsNote(q: { total: number; header_discount_pct: number; tax_pct: number; shipping_amount: number }): string {
  const bits: string[] = [];
  if (q.header_discount_pct > 0) bits.push(`discount ${q.header_discount_pct}%`);
  if (q.tax_pct > 0) bits.push(`tax ${q.tax_pct}%`);
  if (q.shipping_amount > 0) bits.push(`shipping ${money(q.shipping_amount)}`);
  return `Total in BPMSquare: ${money(q.total)}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}
