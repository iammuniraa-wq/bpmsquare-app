"use client";

import { useState } from "react";
import { c } from "@/lib/theme";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import SidePanel from "@/components/ui/SidePanel";
import SettingsSection from "@/components/settings/SettingsSection";
import { SEND_CHANNELS, SEND_CHANNEL_LABEL, SEND_DOCUMENTS, SEND_DOCUMENT_LABEL, SEND_LIMITS, type BidVersionSummary, type SendChannel, type SendDocument, type SendsData } from "@/lib/tender/bids/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";
import s from "./SentToClient.module.css";

// "Sent to client" on the Bid tab (KAMCO feedback slice 5): every time the priced BOQ or the answer sheet went to the client. An email
// sent from the tender lands here by itself; a portal upload or a letter is recorded by hand. A table on a PC, cards under 780 px.

const SHOWN = 5;
const fmtStamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function SentToClient({ opportunityId, sends, versions, canEdit, onRecorded, onError, onNotice }: {
  opportunityId: string;
  sends: SendsData;
  versions: readonly BidVersionSummary[];
  canEdit: boolean;
  /** Called after a send was recorded, so the list is read again. */
  onRecorded: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState(false);
  const rows = showAll ? sends.rows : sends.rows.slice(0, SHOWN);

  return (
    <SettingsSection id="tender.bids.sent" title="Sent to client" info={TENDER_TIPS.sentToClient} summary={sends.pending ? "Needs a database update" : sends.rows.length === 0 ? "Nothing sent yet" : `${sends.rows.length} sent`} defaultOpen={sends.rows.length > 0 || sends.pending}>
      <div data-guide="tender.bid.sent" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {sends.pending && <div role="alert" data-guide="tender.bid.sent_pending" style={{ fontSize: 13, color: "var(--amberink)" }}>Sent-to-client records need a database update (migration 0237). Ask your administrator to apply it.</div>}
        {!sends.pending && sends.rows.length === 0 && <div style={{ fontSize: 13, color: c.hint }}>Nothing has gone to the client yet. Send a file by email above, or record a portal upload.</div>}
        {rows.length > 0 && (
          <>
            <div className={s.tableWrap}>
              <table className={s.table} data-guide="tender.bid.sent_table">
                <thead><tr><th>When</th><th>Who</th><th>Document</th><th>How</th><th>To</th><th>Version</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} data-guide="tender.bid.sent_row">
                      <td>{fmtStamp(r.sent_at)}</td>
                      <td>{r.sent_by_name ?? "—"}</td>
                      <td>{SEND_DOCUMENT_LABEL[r.document]}</td>
                      <td>{SEND_CHANNEL_LABEL[r.channel]}</td>
                      <td className={s.wrap}>{r.to_text ?? "—"}{r.note ? <div className={s.note}>{r.note}</div> : null}</td>
                      <td>{r.version_no ? `v${r.version_no}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={s.cards}>
              {rows.map((r) => (
                <div key={r.id} className={s.card} data-guide="tender.bid.sent_card">
                  <div className={s.cardTitle}>{SEND_DOCUMENT_LABEL[r.document]} · {SEND_CHANNEL_LABEL[r.channel].toLowerCase()}</div>
                  <div className={s.cardLine}>{fmtStamp(r.sent_at)}{r.sent_by_name ? ` · ${r.sent_by_name}` : ""}</div>
                  <div className={s.cardLine}>To {r.to_text ?? "—"}{r.version_no ? ` · version ${r.version_no}` : ""}</div>
                  {r.note ? <div className={s.note}>{r.note}</div> : null}
                </div>
              ))}
            </div>
          </>
        )}
        {!showAll && sends.rows.length > SHOWN && (
          <div><Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="tender.bid.sent_show_all" onClick={() => setShowAll(true)}>Show all {sends.rows.length}</Button></div>
        )}
        {canEdit && !sends.pending && (
          <div><Button variant="secondary" style={{ minHeight: 44 }} data-guide="tender.bid.record_send" onClick={() => setOpen(true)}>+ Record a send</Button></div>
        )}
      </div>
      {open && <RecordSend opportunityId={opportunityId} versions={versions} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onNotice("Recorded under Sent to client"); onRecorded(); }} onError={onError} />}
    </SettingsSection>
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
