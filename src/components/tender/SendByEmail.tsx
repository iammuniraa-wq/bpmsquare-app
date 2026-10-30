"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import { SEND_DOCUMENT_LABEL, SEND_LIMITS, isEmailAddress, type EmailDocument } from "@/lib/tender/bids/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";

/**
 * "Send by email" for one of the two files the tender builds (KAMCO feedback slice 5): a side panel (a bottom sheet on a phone) with the
 * address and an optional note. The server builds the file, sends it as an attachment and records it under Sent to client; a demo
 * workspace is redirected, and the answer says so.
 */
export default function SendByEmail({ opportunityId, document, onClose, onSent }: {
  opportunityId: string;
  document: EmailDocument;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setError("");
    if (!isEmailAddress(to)) { setError("Enter a valid email address"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/bids/send-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, to: to.trim(), note }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not send the email"); return; }
      const intended = Array.isArray(j.intended) ? j.intended.join(", ") : to.trim();
      onSent(j.redirected ? `${SEND_DOCUMENT_LABEL[document]} sent to the workspace test inbox (addressed to ${intended}).` : `${SEND_DOCUMENT_LABEL[document]} sent to ${intended}.`);
    } catch {
      setError("Could not reach the server");
    } finally { setBusy(false); }
  }

  return (
    <SidePanel
      title="Send by email" label="Send by email" onClose={onClose}
      subtitle={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>{SEND_DOCUMENT_LABEL[document]}<InfoTip label="Send by email">{TENDER_TIPS.sendByEmail}</InfoTip></span>}
      footer={
        <div data-guide="tender.bid.email_footer" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" loading={busy} data-guide="tender.bid.email_send" style={{ flex: "1 1 160px", minHeight: 44 }} onClick={() => void send()}>Send</Button>
          <Button variant="secondary" disabled={busy} data-guide="tender.bid.email_cancel" style={{ flex: "1 1 160px", minHeight: 44 }} onClick={onClose}>Cancel</Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-guide="tender.bid.email_form">
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <Field label="To" required guide="tender.bid.email_to"><Input type="email" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} maxLength={SEND_LIMITS.toMax} style={{ minHeight: 44 }} /></Field>
        <Field label="Note" guide="tender.bid.email_note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={SEND_LIMITS.noteMax} style={{ minHeight: 96 }} /></Field>
      </div>
    </SidePanel>
  );
}
