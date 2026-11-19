"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import { SEND_DOCUMENT_LABEL, SEND_LIMITS, isEmailAddress, type EmailDocument } from "@/lib/tender/bids/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";

const TICK_GUIDE: Record<EmailDocument, string> = { priced_boq: "tender.bid.email_priced", answer_sheet: "tender.bid.email_answer" };
const listed = (docs: readonly EmailDocument[]) => docs.map((d, i) => (i === 0 ? SEND_DOCUMENT_LABEL[d] : SEND_DOCUMENT_LABEL[d].toLowerCase())).join(" and ");

/**
 * "Send by email" for the files the tender builds (KAMCO feedback slice 5): a side panel (a bottom sheet on a phone) with a tick per file,
 * the address and an optional note. Every file is ticked to start with. The route takes one file per email, so each ticked file goes as
 * its own email, one after the other; the server builds the file, sends it as an attachment and records it under Sent to client. A demo
 * workspace is redirected, and the answer says so. A file that went is unticked, so trying again never sends it twice.
 */
export default function SendByEmail({ opportunityId, documents, onClose, onSent, onPartlySent }: {
  opportunityId: string;
  /** The files on offer, in the order shown. */
  documents: readonly EmailDocument[];
  onClose: () => void;
  onSent: (message: string) => void;
  /** Some files went and one did not: the panel stays open with the error, and the caller reads Sent to client again. */
  onPartlySent?: () => void;
}) {
  const [ticked, setTicked] = useState<readonly EmailDocument[]>(documents);
  const [done, setDone] = useState<readonly EmailDocument[]>([]);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setError("");
    const chosen = documents.filter((d) => ticked.includes(d));
    if (chosen.length === 0) { setError("Tick at least one document"); return; }
    if (!isEmailAddress(to)) { setError("Enter a valid email address"); return; }
    setBusy(true);
    const went: EmailDocument[] = [];
    let intended = to.trim();
    let redirected = false;
    let failure = "";
    try {
      for (const document of chosen) {
        const res = await fetch(`/api/opportunities/${opportunityId}/tender/bids/send-email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, to: to.trim(), note }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { failure = `${SEND_DOCUMENT_LABEL[document]}: ${j.error ?? "could not send the email"}`; break; }
        if (Array.isArray(j.intended)) intended = j.intended.join(", ");
        redirected = redirected || !!j.redirected;
        went.push(document);
      }
    } catch {
      failure = "Could not reach the server";
    } finally { setBusy(false); }
    const all = [...done, ...went];
    if (!failure) {
      onSent(redirected ? `${listed(all)} sent to the workspace test inbox (addressed to ${intended}).` : `${listed(all)} sent to ${intended}.`);
      return;
    }
    if (went.length > 0) {
      setDone(all);
      setTicked((t) => t.filter((d) => !went.includes(d)));
      onPartlySent?.();
    }
    setError(went.length > 0 ? `${listed(went)} sent. ${failure}` : failure);
  }

  return (
    <SidePanel
      title="Send by email" label="Send by email" onClose={onClose}
      subtitle={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Documents we send<InfoTip label="Send by email">{TENDER_TIPS.sendByEmail}</InfoTip></span>}
      footer={
        <div data-guide="tender.bid.email_footer" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" loading={busy} data-guide="tender.bid.email_send" style={{ flex: "1 1 160px", minHeight: 44 }} onClick={() => void send()}>Send</Button>
          <Button variant="secondary" disabled={busy} data-guide="tender.bid.email_cancel" style={{ flex: "1 1 160px", minHeight: 44 }} onClick={onClose}>Cancel</Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-guide="tender.bid.email_form">
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <fieldset data-guide="tender.bid.email_documents" disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column" }}>
          <legend style={{ fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: 2 }}>Attach</legend>
          {documents.map((d) => {
            const sent = done.includes(d);
            return (
              <label key={d} data-guide={TICK_GUIDE[d]} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13.5, cursor: sent ? "default" : "pointer" }}>
                <input type="checkbox" checked={ticked.includes(d)} disabled={sent} onChange={(e) => setTicked((t) => (e.target.checked ? [...t, d] : t.filter((x) => x !== d)))} style={{ width: 20, height: 20 }} />
                {SEND_DOCUMENT_LABEL[d]}{sent ? " (sent)" : ""}
              </label>
            );
          })}
        </fieldset>
        <Field label="To" required guide="tender.bid.email_to"><Input type="email" inputMode="email" autoComplete="off" value={to} onChange={(e) => setTo(e.target.value)} maxLength={SEND_LIMITS.toMax} style={{ minHeight: 44 }} /></Field>
        <Field label="Note" guide="tender.bid.email_note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={SEND_LIMITS.noteMax} style={{ minHeight: 96 }} /></Field>
      </div>
    </SidePanel>
  );
}
