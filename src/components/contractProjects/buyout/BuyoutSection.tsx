"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import { isPending, loadBuyout } from "./api";
import BuyoutTab from "./BuyoutTab";
import type { BuyoutData } from "./types";

// The Buy-out tab as the project page mounts it. The page cannot read the buy-out tables itself (they have their own routes), so this
// reads GET /api/contract-projects/[id]/buyout once when the tab opens and hands the answer to BuyoutTab, which re-reads it after every
// change. While the database update is pending it says so instead of failing.

export default function BuyoutSection({ projectId, currency, canEdit }: { projectId: string; currency: string | null; canEdit: boolean }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; data: BuyoutData } | { kind: "pending" } | { kind: "error"; message: string }>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void loadBuyout<BuyoutData>(projectId).then((r) => {
      if (!live) return;
      if (r.ok && !r.json.pending) setState({ kind: "ready", data: r.json });
      else if (isPending(r.status, r.json)) setState({ kind: "pending" });
      else setState({ kind: "error", message: r.json.error ?? "Could not load Buy-out" });
    });
    return () => { live = false; };
  }, [projectId]);

  if (state.kind === "loading") return <div role="status" data-guide="buyout.loading" style={{ fontSize: 13, color: c.hint }}>Loading Buy-out…</div>;
  if (state.kind === "pending") return <div role="alert" data-guide="buyout.pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Buy-out needs a database update. Ask your administrator to apply it.</div>;
  if (state.kind === "error") return <div role="alert" data-guide="buyout.error" style={{ fontSize: 13, color: "var(--redink)" }}>{state.message}</div>;
  return <BuyoutTab projectId={projectId} data={state.data} currency={currency} canEdit={canEdit} />;
}
