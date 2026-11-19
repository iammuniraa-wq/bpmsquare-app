"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
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

/**
 * "Download priced BOQ": the client's file with the rates in it. `withWbs` adds the optional WBS column. In a list row the visible word
 * is `label` (the full name stays the accessible name) and the i sits by the row's name (`tip={false}`).
 */
export function PricedBoqButton({ opportunityId, variant = "primary", withWbs = false, label, tip = true }: { opportunityId: string; variant?: "primary" | "secondary"; withWbs?: boolean; label?: string; tip?: boolean }) {
  const { confirm } = useFeel();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant={variant} loading={busy} aria-label={label ? "Download priced BOQ" : undefined} onClick={async () => { setBusy(true); try { await download(opportunityId, "priced", confirm, withWbs); } finally { setBusy(false); } }} style={{ minHeight: 44 }} data-guide="boq.download">{label ?? "Download priced BOQ"}</Button>
      {tip && <InfoTip label="Download">{TENDER_TIPS.boqDownload}</InfoTip>}
    </>
  );
}

/** "Export answer sheet": a plain list of the lines with our rates, for a portal form. `label` and `tip` as on the priced button. */
export function AnswerSheetButton({ opportunityId, variant = "secondary", label, tip = true }: { opportunityId: string; variant?: "primary" | "secondary"; label?: string; tip?: boolean }) {
  const { confirm } = useFeel();
  return (
    <>
      <Button variant={variant} aria-label={label ? "Export answer sheet" : undefined} onClick={() => void download(opportunityId, "answer", confirm)} style={{ minHeight: 44 }} data-guide="boq.answer_sheet">{label ?? "Export answer sheet"}</Button>
      {tip && <InfoTip label="Answer sheet">{TENDER_TIPS.boqAnswerSheet}</InfoTip>}
    </>
  );
}

const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", padding: "6px 12px", minHeight: 56 };
const name: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, flex: "1 1 180px", minWidth: 0, fontSize: 13.5, fontWeight: 600, color: c.ink };
const tag: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: c.muted, border: `1px solid ${c.line}`, borderRadius: 999, padding: "1px 8px" };
const actions: React.CSSProperties = { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: "4px 12px", marginLeft: "auto" };

/**
 * Both, as one list for the Bid tab's "Documents we send": a row per document (name, its i, the format, its download). When the tender has
 * a WBS a checkbox offers its optional column in the priced file; it is off by default (the file is the client's own layout) and the choice
 * is not remembered. `footer` is the one action for the whole list (Send by email), so it is never repeated per row.
 */
export default function BoqDownloads({ opportunityId, footer, hasWbs }: { opportunityId: string; footer?: React.ReactNode; hasWbs?: boolean }) {
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
    <div data-guide="boq.downloads" role="list" style={{ border: `1px solid ${c.line}`, borderRadius: 8, overflow: "hidden" }}>
      <div role="listitem" data-guide="boq.downloads.priced" style={{ ...row, borderBottom: `1px solid ${c.line}` }}>
        <span style={name}>Priced BOQ<InfoTip label="Download">{TENDER_TIPS.boqDownload}</InfoTip><span style={tag}>Excel</span></span>
        <span style={actions}>
          {wbs && (
            <label data-guide="boq.download_wbs" style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, fontSize: 13, cursor: "pointer" }}>
              <input type="checkbox" checked={withWbs} onChange={(e) => setWithWbs(e.target.checked)} style={{ width: 20, height: 20 }} />
              Add a WBS column
              <InfoTip label="WBS column">{TENDER_TIPS.boqWbsColumn}</InfoTip>
            </label>
          )}
          <PricedBoqButton opportunityId={opportunityId} variant="secondary" withWbs={wbs && withWbs} label="Download" tip={false} />
        </span>
      </div>
      <div role="listitem" data-guide="boq.downloads.answer" style={{ ...row, borderBottom: footer ? `1px solid ${c.line}` : undefined }}>
        <span style={name}>Answer sheet<InfoTip label="Answer sheet">{TENDER_TIPS.boqAnswerSheet}</InfoTip><span style={tag}>Excel</span></span>
        <span style={actions}><AnswerSheetButton opportunityId={opportunityId} label="Download" tip={false} /></span>
      </div>
      {footer && <div data-guide="boq.downloads.actions" style={{ ...row, justifyContent: "flex-end", background: "var(--panel2)" }}>{footer}</div>}
    </div>
  );
}
