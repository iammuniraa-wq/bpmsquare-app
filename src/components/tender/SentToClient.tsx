"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import InfoTip from "@/components/ui/InfoTip";
import { SEND_CHANNELS, SEND_CHANNEL_LABEL, SEND_DOCUMENTS, SEND_DOCUMENT_LABEL, SEND_LIMITS, type BidVersionSummary, type SendChannel, type SendDocument, type SendsData } from "@/lib/tender/bids/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";

// "Sent to client" on the Bid tab: ONE line (gap 26, 2026-11-19). The list itself lives on the Interactions tab, which already draws
// every send (an email from the tender, a recorded portal upload or letter) on the client timeline; two lists of the same rows was one
// too many. What stays here: how many went and when the last one did, the way to the timeline, and "Record a send" for a portal upload.

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

/** "2 sends · last 19 Nov", or "Nothing sent yet". */
export function sendsSummary(rows: readonly { sent_at: string }[]): string {
  if (rows.length === 0) return "Nothing sent yet";
  const last = rows.reduce((a, r) => (r.sent_at > a ? r.sent_at : a), rows[0].sent_at);
  return `${rows.length} ${rows.length === 1 ? "send" : "sends"} · last ${fmtDay(last)}`;
}

export default function SentToClient({ opportunityId, sends, versions, canEdit, onRecorded, onError, onNotice, onOpenInteractions }: {
  opportunityId: string;
  sends: SendsData;
  versions: readonly BidVersionSummary[];
  canEdit: boolean;
  /** Called after a send was recorded, so the count is read again. */
  onRecorded: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** Opens the Interactions tab, where every send is listed. Absent: no link. */
  onOpenInteractions?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div data-guide="tender.bid.sent" style={{ background: "var(--panel)", border: `1px solid ${c.line}`, borderRadius: 12, padding: "10px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      {sends.pending && <div role="alert" data-guide="tender.bid.sent_pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Sent-to-client records need a database update (migration 0237). Ask your administrator to apply it.</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13.5, fontWeight: 700, color: c.ink }}>Sent to client<InfoTip label="Sent to client">{TENDER_TIPS.sentToClient}</InfoTip></span>
        {!sends.pending && <span data-guide="tender.bid.sent_summary" style={{ fontSize: 13, color: c.muted }}>{sendsSummary(sends.rows)}</span>}
        <span style={{ flex: "1 1 0" }} />
        {onOpenInteractions && !sends.pending && sends.rows.length > 0 && (
          <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="tender.bid.sent_open" onClick={onOpenInteractions}>See in Interactions</Button>
        )}
        {canEdit && !sends.pending && (
          <Button variant="secondary" size="sm" style={{ minHeight: 44 }} data-guide="tender.bid.record_send" onClick={() => setOpen(true)}>+ Record a send</Button>
        )}
      </div>
      {open && <RecordSend opportunityId={opportunityId} versions={versions} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onNotice("Recorded. It is listed on the Interactions tab"); onRecorded(); }} onError={onError} />}
    </div>
  );
}

function RecordSend({ opportunityId, versions, onClose, onDone, onError }: {
  opportunityId: string; versions: readonly BidVersionSummary[]; onClose: () => void; onDone: () => void; onError: (message: string) => void;
}) {
  const [document, setDocument] = useState<SendDocument>("priced_boq");
  const [channel, setChannel] = useState<SendChannel>("portal");
  const [to, setTo] = useState("");
  const [version, setVersion] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError(""); onError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/bids/sends`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document, channel, to_text: to, version_no: version ? Number(version) : null, note }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not record the send"); return; }
      onDone();
    } catch {
      setError("Could not reach the server");
    } finally { setBusy(false); }
  }

  return (
    <SidePanel
      title="Record a send" label="Record a send" onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" loading={busy} data-guide="tender.bid.record_save" style={{ flex: "1 1 160px", minHeight: 44 }} onClick={() => void save()}>Save</Button>
          <Button variant="secondary" disabled={busy} data-guide="tender.bid.record_cancel" style={{ flex: "1 1 160px", minHeight: 44 }} onClick={onClose}>Cancel</Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-guide="tender.bid.record_form">
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <Field label="Document" guide="tender.bid.record_document">
          <Select value={document} onChange={(e) => setDocument(e.target.value as SendDocument)} style={{ minHeight: 44 }}>
            {SEND_DOCUMENTS.map((d) => <option key={d} value={d}>{SEND_DOCUMENT_LABEL[d]}</option>)}
          </Select>
        </Field>
        <Field label="How" guide="tender.bid.record_channel">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as SendChannel)} style={{ minHeight: 44 }}>
            {SEND_CHANNELS.map((x) => <option key={x} value={x}>{SEND_CHANNEL_LABEL[x]}</option>)}
          </Select>
        </Field>
        <Field label="To" guide="tender.bid.record_to"><Input value={to} onChange={(e) => setTo(e.target.value)} maxLength={SEND_LIMITS.toMax} style={{ minHeight: 44 }} /></Field>
        {versions.length > 0 && (
          <Field label="Version" guide="tender.bid.record_version">
            <Select value={version} onChange={(e) => setVersion(e.target.value)} style={{ minHeight: 44 }}>
              <option value="">— None —</option>
              {versions.map((v) => <option key={v.id} value={v.version_no}>Version {v.version_no}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Note" guide="tender.bid.record_note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={SEND_LIMITS.noteMax} style={{ minHeight: 80 }} /></Field>
      </div>
    </SidePanel>
  );
}
