"use client";

import { money } from "@/lib/contractProjects/format";
import { overBudget } from "./buyout/rules";
import type { BuyoutData } from "./buyout/types";
import { useBuyoutSummary } from "./buyout/useBuyoutSummary";

/**
 * What has been ordered, as one line under the Budget figure of the Key figures: "Ordered SAR 1,040,000 · over by SAR 355,063". The
 * figure is the Buy-out summary's own committed total (awarded and handed-over packages), never summed again here. It renders nothing
 * while the summary loads, when Buy-out is not available, and while nothing is ordered. `initial` lets a server render (and its test)
 * show the loaded state.
 */
export default function BudgetOrdered({ projectId, budget, currency, initial }: { projectId: string; budget: number; currency: string | null; initial?: BuyoutData | null }) {
  const data = useBuyoutSummary(projectId, true, initial);
  const ordered = data?.tiles.committed ?? 0;
  if (!(ordered > 0)) return null;
  const over = overBudget(ordered, budget);
  return (
    <span data-guide="cp.kpis.ordered" role={over > 0 ? "status" : undefined} style={{ display: "block", fontWeight: over > 0 ? 600 : undefined, color: over > 0 ? "var(--amberink)" : undefined }}>
      Ordered {money(ordered, currency)}{over > 0 ? ` · over by ${money(over, currency)}` : ""}
    </span>
  );
}
