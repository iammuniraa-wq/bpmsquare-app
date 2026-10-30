"use client";

import { useEffect, useState } from "react";
import { loadBuyout } from "./api";
import type { BuyoutData } from "./types";

/**
 * The buy-out summary for the screens that only show a figure from it (the Overview card, the Budget tab's Ordered column). It reads
 * GET /api/contract-projects/[id]/buyout once after mount and answers null while it loads or when it is unavailable (the database update
 * is pending, the route is missing, the person may not see it), so those screens simply leave their addition out. `initial` lets a server
 * render (and its test) show the loaded state.
 */
export function useBuyoutSummary(projectId: string, enabled: boolean, initial?: BuyoutData | null): BuyoutData | null {
  const [data, setData] = useState<BuyoutData | null>(initial ?? null);
  useEffect(() => {
    if (!enabled || initial) return;
    let live = true;
    void loadBuyout<BuyoutData>(projectId).then((r) => { if (live && r.ok && !r.json.pending && Array.isArray(r.json.packages)) setData(r.json); });
    return () => { live = false; };
  }, [projectId, enabled, initial]);
  return enabled ? data : null;
}
