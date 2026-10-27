// Tax on an invoicing milestone. PURE.
//
// The rule the invoices object already lives by, followed here and not invented: an invoice stores the NET amount of its lines. Tax is not a
// stored line. A Saudi e-invoicing workspace gives every line a VAT category at the Kingdom's standard rate when the line arrives without one
// (POST /api/invoices, defaultLineVat) and the e-invoice panel and print add the VAT per line; any other workspace's print adds the tax of
// tenants.config.tax (Settings > Company > Tax) on top of the subtotal. The quote, work order and standard quote invoices do the same.
//
// So a milestone amount is the amount BEFORE tax, the invoice is made with exactly that amount, and what the screen and the invoice notes
// add is the statement of which tax comes on top, and what the figure with tax will be. When the workspace has no tax set, it says so.

import { ZATCA_RULES } from "@/lib/einvoicing/rules";

export type MilestoneTax =
  /** Tax is added on top of the milestone amount: the e-invoice VAT of a Saudi workspace, or the workspace tax setting. */
  | { kind: "added"; label: string; rate: number; source: "einvoice" | "workspace" }
  /** The workspace tax setting says amounts already include tax: nothing is added. */
  | { kind: "included"; label: string; rate: number }
  /** The workspace has no tax set (no rate above zero). */
  | { kind: "none" };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The tenants.config.tax a workspace stores, whatever of it is there. */
export type TaxSetting = { label?: unknown; rate?: unknown; inclusive?: unknown } | null | undefined;

export function resolveMilestoneTax(args: { einvoicing: boolean; tax: TaxSetting }): MilestoneTax {
  if (args.einvoicing) return { kind: "added", label: "VAT", rate: ZATCA_RULES.standardRate, source: "einvoice" };
  const rate = Number(args.tax?.rate);
  if (!args.tax || !Number.isFinite(rate) || rate <= 0) return { kind: "none" };
  const label = typeof args.tax.label === "string" && args.tax.label.trim() ? args.tax.label.trim().slice(0, 20) : "Tax";
  return args.tax.inclusive === true ? { kind: "included", label, rate } : { kind: "added", label, rate, source: "workspace" };
}

/** The tax that comes on top of a net amount, and the figure with it. Inclusive and no-tax workspaces add nothing. */
export function taxOn(net: number, tax: MilestoneTax): { tax: number; gross: number } {
  if (tax.kind !== "added") return { tax: 0, gross: round2(net) };
  const t = round2(net * (tax.rate / 100));
  return { tax: t, gross: round2(net + t) };
}

const rateText = (r: number) => `${r.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** The short line for the milestone row and panel: what the shown amount is before. */
export function taxBasisText(tax: MilestoneTax): string {
  switch (tax.kind) {
    case "added": return `Before ${tax.label} ${rateText(tax.rate)}`;
    case "included": return `Includes ${tax.label} ${rateText(tax.rate)}`;
    default: return "No tax configured";
  }
}

/** The sentence the invoice's notes carry, with the figures when there is tax to add. */
export function taxNote(tax: MilestoneTax, net: number, fmt: (n: number) => string): string {
  switch (tax.kind) {
    case "added": {
      const { tax: t, gross } = taxOn(net, tax);
      return `Amount before ${tax.label}: ${fmt(net)}. ${tax.label} ${rateText(tax.rate)}: ${fmt(t)}. Total with ${tax.label}: ${fmt(gross)}.`;
    }
    case "included": return `Amount includes ${tax.label} ${rateText(tax.rate)}.`;
    default: return "No tax configured for this workspace, so none is added.";
  }
}
