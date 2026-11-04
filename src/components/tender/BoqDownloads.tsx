"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import { TENDER_TIPS } from "@/lib/tender/tips";

// The two downloads of a tender's BOQ (GCC tender deals): the client's own Excel with our rates written in, and a plain answer sheet.
// They are not on the Bill of quantities toolbar (owner, 2026-10-27); the Bid tab mounts these two. The routes are unchanged
// (/api/opportunities/[id]/boq/export?kind=priced|answer). Before a priced file is written the screen asks the server how many lines
// have no rate, so a person never sends a file with blanks without having been told.

type Kind = "priced" | "answer";
type Unpriced = { item: string; reason: string };

async function download(opportunityId: string, kind: Kind, confirm: ReturnType<typeof useFeel>["confirm"], withWbs = false) {
  const base = `/api/opportunities/${opportunityId}/boq`;
  if (kind === "priced") {
    let list: Unpriced[] = [];
    let count = 0;
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (res.ok) {
        const j = await res.json();
        list = Array.isArray(j.unpriced) ? j.unpriced : [];
        count = Number(j.totals?.unpriced ?? list.length) || 0;
      }
    } catch { /* the download below still works; the warning is a courtesy */ }
    if (count > 0) {
      const names = list.slice(0, 10).map((u) => `${u.item} (${u.reason})`).join("\n");
      const more = count > 10 ? `\n…and ${count - 10} more` : "";
      if (!(await confirm({ title: `${count} line${count === 1 ? " has" : "s have"} no rate`, body: `They are left blank in the file.\n${names}${more}`, confirmLabel: "Download anyway" }))) return;
    }
  }
  window.location.assign(`${base}/export?kind=${kind}${kind === "priced" && withWbs ? "&wbs=1" : ""}`);
}

/** "Download priced BOQ": the client's file with the rates in it. `withWbs` adds the optional WBS column. */
export function PricedBoqButton({ opportunityId, variant = "primary", withWbs = false }: { opportunityId: string; variant?: "primary" | "secondary"; withWbs?: boolean }) {
  const { confirm } = useFeel();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} loading={busy} onClick={async () => { setBusy(true); try { await download(opportunityId, "priced", confirm, withWbs); } finally { setBusy(false); } }} style={{ minHeight: 44 }} data-guide="boq.download">Download priced BOQ</Button>
      <InfoTip label="Download">{TENDER_TIPS.boqDownload}</InfoTip>
    </>
  );
}

/** "Export answer sheet": a plain list of the lines with our rates, for a portal form. */
export function AnswerSheetButton({ opportunityId, variant = "secondary" }: { opportunityId: string; variant?: "primary" | "secondary" }) {
  const { confirm } = useFeel();
  return (
    <>
      <Button variant={variant} onClick={() => void download(opportunityId, "answer", confirm)} style={{ minHeight: 44 }} data-guide="boq.answer_sheet">Export answer sheet</Button>
      <InfoTip label="Answer sheet">{TENDER_TIPS.boqAnswerSheet}</InfoTip>
    </>
  );
}

/**
 * Both, side by side, for the Bid tab's "Documents we send". When the tender has a WBS a checkbox offers its optional column in the priced file;
 * it is off by default (the file is the client's own layout) and the choice is not remembered.
 */
export default function BoqDownloads({ opportunityId, afterPriced, afterAnswer, hasWbs }: { opportunityId: string; afterPriced?: React.ReactNode; afterAnswer?: React.ReactNode; hasWbs?: boolean }) {
  const [wbs, setWbs] = useState(hasWbs ?? false);
  const [withWbs, setWithWbs] = useState(false);
  useEffect(() => {
    if (hasWbs !== undefined) return;
    let live = true;
    void fetch(`/api/opportunities/${opportunityId}/tender/wbs`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((j: { pending?: boolean; items?: unknown[] } | null) => { if (live) setWbs(!!j && !j.pending && Array.isArray(j.items) && j.items.length > 0); })
      .catch(() => { /* the column is a courtesy; without the answer it is simply not offered */ });
    return () => { live = false; };
  }, [opportunityId, hasWbs]);
  return (
    <div data-guide="boq.downloads" style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px", alignItems: "center" }}>
      <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <PricedBoqButton opportunityId={opportunityId} withWbs={wbs && withWbs} />
        {wbs && (
          <label data-guide="boq.download_wbs" style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={withWbs} onChange={(e) => setWithWbs(e.target.checked)} style={{ width: 20, height: 20 }} />
            Add a WBS column
            <InfoTip label="WBS column">{TENDER_TIPS.boqWbsColumn}</InfoTip>
          </label>
        )}
        {afterPriced}
      </span>
      <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <AnswerSheetButton opportunityId={opportunityId} />
        {afterAnswer}
      </span>
    </div>
  );
}
