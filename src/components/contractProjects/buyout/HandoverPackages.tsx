"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import StatusPill from "@/components/ui/StatusPill";
import { ROUTES } from "@/lib/constants";
import { handoverUrl, isPending, loadBuyout } from "./api";
import { HANDOVER_LABEL, HANDOVER_TONE } from "./rules";
import type { BuyoutData } from "./types";

// The Packages part of the project's "ERP handover" tab: each awarded buy-out package with its order file and whether it was sent. It shows
// the result only; a package is marked as sent on the package itself, in Buy-out (one home for the action). Five rows, then "show all".

const SHOWN = 5;
type State = { kind: "loading" } | { kind: "ready"; data: BuyoutData } | { kind: "off"; message: string };

export default function HandoverPackages({ projectId, initial }: { projectId: string; initial?: BuyoutData }) {
  const [state, setState] = useState<State>(initial ? { kind: "ready", data: initial } : { kind: "loading" });
  const [all, setAll] = useState(false);
  useEffect(() => {
    if (initial) return;
    let live = true;
    void loadBuyout<BuyoutData>(projectId).then((r) => {
      if (!live) return;
      if (r.ok && !r.json.pending && Array.isArray(r.json.packages)) setState({ kind: "ready", data: r.json });
      else setState({ kind: "off", message: isPending(r.status, r.json) ? "Buy-out needs a database update. Ask your administrator to apply it." : r.json.error ?? "Could not load the packages" });
    });
    return () => { live = false; };
  }, [projectId, initial]);

  const buyoutHref = `${ROUTES.contractProject(projectId)}?tab=buyout`;
  if (state.kind === "loading") return <div role="status" style={{ fontSize: 13, color: c.hint }}>Loading the packages…</div>;
  if (state.kind === "off") return <div role="alert" style={{ fontSize: 13, color: "var(--amberink)" }}>{state.message}</div>;
  const awarded = state.data.packages.filter((p) => p.status === "awarded" || p.status === "handed_over");
  if (awarded.length === 0) {
    return (
      <div data-guide="cp.handover.packages" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 13, color: c.muted }}>
        <span>No awarded packages yet.</span>
        <Button variant="secondary" href={buyoutHref} data-guide="cp.handover.to_buyout" style={{ minHeight: 44 }}>Open Buy-out</Button>
      </div>
    );
  }
  const list = all ? awarded : awarded.slice(0, SHOWN);
  return (
    <div data-guide="cp.handover.packages" className="bpm-tap" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {list.map((p) => (
        <div key={p.id} data-guide="cp.handover.package" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", border: `1px solid ${c.line}`, borderRadius: 8, padding: "8px 12px" }}>
          <span style={{ flex: "1 1 180px", minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: c.ink, overflowWrap: "anywhere" }}>{p.name}</span>
            <span style={{ display: "block", fontSize: 12, color: c.hint, overflowWrap: "anywhere" }}>{[p.ref, p.awarded_supplier_name].filter(Boolean).join(" · ")}</span>
          </span>
          <StatusPill label={HANDOVER_LABEL[p.handover.state]} tone={HANDOVER_TONE[p.handover.state]} />
          <Button variant="secondary" href={handoverUrl(projectId, p.id)} download data-guide="cp.handover.package.download" style={{ minHeight: 44 }}>Download Excel</Button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {awarded.length > SHOWN && <Button variant="quiet" aria-expanded={all} onClick={() => setAll(!all)} style={{ minHeight: 44 }}>{all ? "Show fewer" : `Show all ${awarded.length}`}</Button>}
        <Button variant="quiet" href={buyoutHref} data-guide="cp.handover.to_buyout" style={{ minHeight: 44 }}>Mark as sent in Buy-out</Button>
      </div>
    </div>
  );
}
