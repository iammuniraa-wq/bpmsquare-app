import type { D365Product } from "@/lib/connectors/d365/types";
import { ESTIMATE_PARTS, FENCE_PARTS, type EstimatePart, type FencePart, type OptionContract, type SelectionContract, type TargetKind } from "./types";

// Which option of "what goes out" the connected product can take. The screen
// greys an option whose `allowed` is false and shows its `hint`; the builders
// enforce the same table, so an option that is ticked but not allowed is
// refused rather than sent.

export function targetFor(product: D365Product | null | undefined): TargetKind | null {
  if (!product) return null;
  return product === "dataverse" ? "quote" : "project";
}

const OK: OptionContract = { allowed: true, hint: null };
const no = (hint: string): OptionContract => ({ allowed: false, hint });

export const QUOTE_PRICES_ONLY = "A Dynamics quote carries prices only; these go to Project targets (SAP, F&O, ePROMIS).";
const PROJECT_NO_LINES = "A project carries tasks and a bill of materials, not customer price lines.";

export function selectionContract(target: TargetKind | null): SelectionContract {
  const fence = {} as Record<FencePart, OptionContract>;
  for (const p of FENCE_PARTS) fence[p] = OK;
  const estimate = {} as Record<EstimatePart, OptionContract>;
  for (const p of ESTIMATE_PARTS) estimate[p] = OK;

  if (target === "quote") {
    estimate.bom = no(QUOTE_PRICES_ONLY);
    estimate.wbs = no(QUOTE_PRICES_ONLY);
    estimate.internal_costs = no(QUOTE_PRICES_ONLY);
  }
  if (target === "project") {
    fence.quantity_lines = no(PROJECT_NO_LINES);
    estimate.quote_lines = no(PROJECT_NO_LINES);
  }
  return { target, fence, estimate };
}
