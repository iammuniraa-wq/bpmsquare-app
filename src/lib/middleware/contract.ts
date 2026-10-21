import type { D365Product } from "@/lib/connectors/d365/types";
import {
  ESTIMATE_PARTS, FENCE_PARTS, INCLUDE_KEYS,
  type EstimatePart, type FencePart, type IncludeKey, type OptionContract, type SelectionContract, type TargetKind,
} from "./types";

// Which option of "what goes out" the connected product can take. The screen
// greys an option whose `allowed` is false and shows its `hint`; the builders
// enforce the same table, so an option that is ticked but not allowed is
// refused rather than sent.

/** The default document a connected product creates: Dynamics Sales a Quote; the ERPs a Project. */
export function targetFor(product: D365Product | null | undefined): TargetKind | null {
  if (!product) return null;
  return product === "dataverse" ? "quote" : "project";
}

/** What each product can create for a Standard Quote, in the order the dropdown shows them. */
export function offeredTargets(product: D365Product | null | undefined): TargetKind[] {
  if (!product) return ["quote", "sales_order", "project"];
  return product === "dataverse" ? ["quote", "sales_order"] : ["project", "sales_order"];
}

/** The stored choice if the product still offers it, else the product's default. */
export function resolveTarget(product: D365Product | null | undefined, stored: TargetKind | null | undefined): TargetKind {
  if (stored && offeredTargets(product).includes(stored)) return stored;
  return targetFor(product) ?? stored ?? "quote";
}

/** A Quote and a Sales Order are customer-facing documents: prices only. */
export const isPriceOnly = (t: TargetKind | null | undefined): boolean => t === "quote" || t === "sales_order";

const OK: OptionContract = { allowed: true, hint: null };
const no = (hint: string): OptionContract => ({ allowed: false, hint });

export const QUOTE_PRICES_ONLY = "A Dynamics quote carries prices only; these go to Project targets (SAP, F&O, ePROMIS).";
export const ORDER_PRICES_ONLY = "A sales order carries prices only; these go to Project targets (SAP, F&O, ePROMIS).";
const PROJECT_NO_LINES = "A project carries tasks and a bill of materials, not customer price lines.";

export const pricesOnlyHint = (t: TargetKind | null | undefined): string => (t === "sales_order" ? ORDER_PRICES_ONLY : QUOTE_PRICES_ONLY);

export function selectionContract(target: TargetKind | null): SelectionContract {
  const fence = {} as Record<FencePart, OptionContract>;
  for (const p of FENCE_PARTS) fence[p] = OK;
  const estimate = {} as Record<EstimatePart, OptionContract>;
  for (const p of ESTIMATE_PARTS) estimate[p] = OK;

  if (isPriceOnly(target)) {
    const hint = pricesOnlyHint(target);
    estimate.bom = no(hint);
    estimate.wbs = no(hint);
    estimate.internal_costs = no(hint);
  }
  if (target === "project") {
    fence.quantity_lines = no(PROJECT_NO_LINES);
    estimate.quote_lines = no(PROJECT_NO_LINES);
  }
  return { target, fence, estimate };
}

/** The same table for the unified `include` list the Quote document shows, with
 *  the short reason (three words) a greyed item carries. */
export function includeContract(target: TargetKind | null): Record<IncludeKey, OptionContract> {
  const out = {} as Record<IncludeKey, OptionContract>;
  for (const k of INCLUDE_KEYS) out[k] = OK;
  if (isPriceOnly(target)) {
    out.bom = no("Prices only here");
    out.wbs = no("Prices only here");
    out.internal_costs = no("Internal, never sent");
  }
  if (target === "project") out.lines = no("Not on projects");
  return out;
}
