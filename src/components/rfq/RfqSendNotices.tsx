"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { c } from "@/lib/theme";
import { ROUTES } from "@/lib/constants";
import type { SendOutcome } from "@/lib/rfq/sendOutcome";
import { btnGhost, btnPrimary } from "./rfqUi";

// What both RFQ create forms say about sending: the blocker BEFORE the send (so the primary button never pretends
// to send through a mail channel that cannot), and the outcome AFTER a send that did not reach everyone.

/** Why the workspace cannot e-mail an RFQ right now; null while unknown or when it can. A failed check never blocks the form. */
export function useRfqSendBlocker(): string | null {
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/rfqs/send-check", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { can_send?: boolean; reason?: string | null } | null) => { if (live && j && j.can_send === false) setReason(j.reason ?? "RFQ email cannot be sent right now."); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return reason;
}

const box: React.CSSProperties = { fontSize: 13, color: "var(--amberink)", background: "var(--amberbg)", padding: "10px 12px", borderRadius: 7, lineHeight: 1.5 };

export function RfqSendBlocker({ reason }: { reason: string }) {
  return (
    <div role="alert" data-guide="rfq.send.blocker" style={box}>
      <strong>Can&apos;t send yet.</strong> {reason} You can save this RFQ as a draft and send it once that is fixed.{" "}
      <Link href={ROUTES.settingsRfq} style={{ color: "inherit", fontWeight: 700, whiteSpace: "nowrap" }}>Settings → RFQ</Link>
    </div>
  );
}

/** Shown in place of the form once the RFQ exists but the send did not reach everyone. `onStay` is offered only where staying makes sense (a dialog over a record). */
export function RfqSendOutcome({ rfq, outcome, onStay }: { rfq: { id: string; ref: string }; outcome: SendOutcome; onStay?: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    boxRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div ref={boxRef} tabIndex={-1} role="alert" data-guide="rfq.send.outcome" style={{ outline: "none", ...box, ...(outcome.nothingSent ? { color: "var(--redink)", background: "var(--redbg)" } : {}) }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{outcome.headline}</div>
        {outcome.reasons.map((r, i) => <div key={i}>{r}</div>)}
      </div>
      <div style={{ fontSize: 13, color: c.muted }}>
        {outcome.nothingSent ? "Nothing is lost: open the RFQ to send it once this is fixed." : "Open the RFQ to send it to the rest."}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {outcome.nothingSent && <Link href={ROUTES.settingsRfq} style={{ ...btnGhost, textDecoration: "none", minHeight: 44, boxSizing: "border-box", display: "inline-flex", alignItems: "center" }}>Settings → RFQ</Link>}
        {onStay && <button type="button" style={{ ...btnGhost, minHeight: 44 }} onClick={onStay}>Close</button>}
        <Link href={ROUTES.rfq(rfq.id)} style={{ ...btnPrimary, textDecoration: "none", minHeight: 44, boxSizing: "border-box", display: "inline-flex", alignItems: "center" }}>Open {rfq.ref || "the RFQ"}</Link>
      </div>
    </div>
  );
}
