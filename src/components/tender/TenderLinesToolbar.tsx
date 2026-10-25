"use client";

import { useEffect, useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import TenderLinesRfq from "@/components/rfq/TenderLinesRfq";
import type { ComposerLine } from "@/components/rfq/RfqComposer";

// The action row of a tender deal's Lines tab (GCC tender deals), ABOVE the lines table: Lines total, Request supplier prices
// (the tender deal's one RFQ button) and Save lines. "Convert to Standard Quote" is the deal header's primary button and is not
// repeated here. A standard deal does not use these components: its Lines tab keeps the action row below the table.
// On a phone the table is long, so once the row has scrolled out of view and there are unsaved edits, TenderLinesSaveBar (drawn
// at the end of the lines, where a sticky bar can follow the page) keeps Save lines reachable above the bottom tab bar.

const TOOLBAR_ID = "tender-lines-toolbar";

function SaveButton({ dirty, serverMoved, pending, onSave }: { dirty: boolean; serverMoved: boolean; pending: boolean; onSave: () => void }) {
  return (
    <Button variant="primary" onClick={onSave} disabled={!dirty || serverMoved} loading={pending} style={{ minHeight: 44 }} data-guide="tender.lines.save">{pending ? "Saving…" : "Save lines"}</Button>
  );
}

export default function TenderLinesToolbar({ total, followsQuote, dirty, serverMoved, pending, onSave, rfq }: {
  /** The formatted lines total. */
  total: string;
  /** The deal has a quote, so its amount follows the latest quote rather than the lines (said behind the "i"). */
  followsQuote: boolean;
  dirty: boolean;
  /** The BOQ changed the lines behind the editor: a save would be refused, so it stays disabled. */
  serverMoved: boolean;
  pending: boolean;
  onSave: () => void;
  rfq: { opportunityId: string; originLabel: string; lines: ComposerLine[] } | null;
}) {
  return (
    <div id={TOOLBAR_ID} data-guide="tender.lines.toolbar" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12.5, color: c.muted, display: "inline-flex", alignItems: "center", gap: 6 }}>
        Lines total <b style={{ color: c.ink }}>{total}</b>
        {followsQuote && <InfoTip label="Lines total">The deal amount follows its latest quote, not these lines.</InfoTip>}
      </span>
      {rfq && <TenderLinesRfq opportunityId={rfq.opportunityId} originLabel={rfq.originLabel} lines={rfq.lines} dirty={dirty} />}
      <span style={{ marginLeft: "auto" }} />
      {dirty && <span style={{ fontSize: 11.5, color: "var(--amberink)" }}>Unsaved changes</span>}
      <SaveButton dirty={dirty} serverMoved={serverMoved} pending={pending} onSave={onSave} />
    </div>
  );
}

/** Phones only: a Save bar that sticks above the tab bar once the toolbar has scrolled out of view and there are unsaved edits. Draws nothing otherwise. */
export function TenderLinesSaveBar({ narrow, dirty, serverMoved, pending, onSave }: { narrow: boolean; dirty: boolean; serverMoved: boolean; pending: boolean; onSave: () => void }) {
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    const el = typeof document === "undefined" ? null : document.getElementById(TOOLBAR_ID);
    if (!narrow || !el || typeof IntersectionObserver === "undefined") { setOffscreen(false); return; }
    const io = new IntersectionObserver(([e]) => setOffscreen(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [narrow]);
  if (!narrow || !offscreen || !dirty) return null;
  return (
    <div className="sticky-actions" data-guide="tender.lines.save_bar" style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", padding: "8px 0", background: c.panel }}>
      <span style={{ fontSize: 11.5, color: "var(--amberink)" }}>Unsaved changes</span>
      <SaveButton dirty={dirty} serverMoved={serverMoved} pending={pending} onSave={onSave} />
    </div>
  );
}
