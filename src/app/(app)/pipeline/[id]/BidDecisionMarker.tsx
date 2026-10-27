"use client";

import { useState } from "react";
import SidePanel from "@/components/ui/SidePanel";
import InfoTip from "@/components/ui/InfoTip";
import { toneTokens } from "@/lib/ui/tone";
import { decisionMarker } from "@/lib/tender/decisionMarker";
import { TENDER_TIPS } from "@/lib/tender/tips";
import type { ApprovalView } from "@/lib/tender/approval";
import type { TenderView } from "@/lib/tender/views";
import BidDecision from "./BidDecision";

/**
 * The bid decision in the deal header: one chip that says where the go / no-go stands (Pending, Awaiting approval, Go, No-go) and opens
 * the approval actions (propose with a reason, approve, reject with a comment, withdraw, history) in the shared side panel, which is a
 * bottom sheet on a phone. The words carry the meaning; the tone only agrees with them.
 */
type PanelProps = {
  opportunityId: string;
  tender: TenderView;
  /** null while migration 0221 is pending. */
  approval: ApprovalView | null;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

/** The approval actions in the shared side panel. The deal header mounts this itself when the primary button "Propose bid decision" opens it. */
export function BidDecisionPanel({ opportunityId, tender, approval, onError, onNotice, onClose }: PanelProps & { onClose: () => void }) {
  const m = decisionMarker(approval, tender.decision);
  return (
    <SidePanel title="Bid decision" subtitle={`${m.label} · ${m.sub}`} label="Bid decision" onClose={onClose}>
      <BidDecision opportunityId={opportunityId} tender={tender} approval={approval} onError={onError} onNotice={onNotice} onDone={onClose} />
    </SidePanel>
  );
}

export default function BidDecisionMarker({ opportunityId, tender, approval, onError, onNotice, initialOpen = false, controlled }: PanelProps & {
  /** Lets a server render (and its test) show the panel without a click. The page never passes it. */
  initialOpen?: boolean;
  /** The page keeps the open state and draws the panel itself (so the header button can open it while this chip is folded away on a phone). */
  controlled?: { open: boolean; setOpen: (open: boolean) => void };
}) {
  const [ownOpen, setOwnOpen] = useState(initialOpen);
  const open = controlled ? controlled.open : ownOpen;
  const setOpen = controlled ? controlled.setOpen : setOwnOpen;
  const m = decisionMarker(approval, tender.decision);
  const t = toneTokens(m.tone);
  return (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%" }}>
        <button
          type="button" data-guide="tender.decision.marker" data-tone={m.tone} data-state={m.key} aria-haspopup="dialog" aria-expanded={open}
          onClick={() => setOpen(true)}
          style={{
            display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 1, minHeight: 44, minWidth: 44, padding: "4px 12px", borderRadius: 10,
            background: t.bg, color: t.ink, border: `1px solid ${t.edge}`, cursor: "pointer", font: "inherit", textAlign: "left", maxWidth: "100%",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, overflowWrap: "anywhere" }}>Bid decision: {m.label}</span>
          <span style={{ fontSize: 11, fontWeight: 500, color: t.quiet, opacity: 0.9, overflowWrap: "anywhere" }}>{m.sub}</span>
        </button>
        <InfoTip label="Bid decision">{TENDER_TIPS.decisionMarker}</InfoTip>
      </span>
      {open && !controlled && <BidDecisionPanel opportunityId={opportunityId} tender={tender} approval={approval} onError={onError} onNotice={onNotice} onClose={() => setOpen(false)} />}
    </>
  );
}
