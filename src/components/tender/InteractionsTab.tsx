"use client";

import { useCallback, useEffect, useState } from "react";
import { ROUTES } from "@/lib/constants";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import InfoTip from "@/components/ui/InfoTip";
import SidePanel from "@/components/ui/SidePanel";
import { KIND_LABEL, MESSAGE_LIMITS, type InteractionEntry, type InteractionsData } from "@/lib/tender/interactions/rules";
import { isEmailAddress } from "@/lib/tender/bids/rules";
import { TENDER_TIPS } from "@/lib/tender/tips";
import s from "./InteractionsTab.module.css";

// The Interactions tab of a tender (KAMCO feedback slice 11): one timeline of the email exchanged with the client, and a compose panel.
// Read-mostly: the client has no login to the app; replies reach the Inbox and are filed here by the Inbox. Mail text is drawn as text.

const SHOWN = 10;
const CLAMP_AT = 280;
const fmtStamp = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function InteractionsTab({ opportunityId, canEdit, initial = null, onError, onNotice, onChanged }: {
  opportunityId: string;
  /** The caller may change the deal (the server decides anyway). */
  canEdit: boolean;
  /** Lets a server render (and its test) show the timeline without a request. The page never passes it. */
  initial?: InteractionsData | null;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<InteractionsData | null>(initial);
  const [loading, setLoading] = useState(initial === null);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/interactions`, { cache: "no-store" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { onError(j.error ?? "Could not load the interactions"); return; }
      setData(j as InteractionsData);
    } catch {
      onError("Could not reach the server");
    } finally { setLoading(false); }
  }, [opportunityId, onError]);
  useEffect(() => { if (initial === null) void load(); }, [initial, load]);

  const entries = data?.entries ?? [];
  const rows = showAll ? entries : entries.slice(0, SHOWN);

  return (
    <div data-guide="tender.interactions" style={{ display: "flex", flexDirection: "column" }}>
      <div className={s.head}>
        <h2 className={`bpm-t-section ${s.title}`}>Interactions<InfoTip label="Interactions">{TENDER_TIPS.interactions}</InfoTip></h2>
        <span className={s.spacer} />
        {canEdit && data && data.mailReady && (
          <Button variant="primary" style={{ minHeight: 44 }} data-guide="tender.interactions.compose" onClick={() => setComposing(true)}>New email</Button>
        )}
      </div>

      {data?.messagesPending && <div role="alert" data-guide="tender.interactions.pending" className={s.banner}>Sending from here needs a database update (migration 0241). Ask your administrator to apply it.</div>}
      {data && !data.messagesPending && !data.mailReady && canEdit && <div role="alert" data-guide="tender.interactions.no_mail" className={s.banner}>Email is not set up on this server.</div>}
      {loading && <div className={s.empty} role="status">Loading…</div>}
      {data && entries.length === 0 && <div className={s.empty} data-guide="tender.interactions.empty">Nothing has been exchanged with the client on this tender yet.{canEdit && data.mailReady ? " Write the first email with New email." : ""}</div>}

      {rows.length > 0 && (
        <div className={s.list} data-guide="tender.interactions.timeline">
          {rows.map((e) => <Entry key={e.key} e={e} expanded={!!open[e.key]} onToggle={() => setOpen((o) => ({ ...o, [e.key]: !o[e.key] }))} />)}
        </div>
      )}
      {!showAll && entries.length > SHOWN && (
        <div style={{ marginTop: 8 }}><Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="tender.interactions.show_all" onClick={() => setShowAll(true)}>Show all {entries.length}</Button></div>
      )}

      {composing && data && (
        <Compose
          opportunityId={opportunityId} suggested={data.suggested} startSubject={data.subject} onClose={() => setComposing(false)}
          onSent={(message) => { setComposing(false); onError(""); onNotice(message); void load(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

function Entry({ e, expanded, onToggle }: { e: InteractionEntry; expanded: boolean; onToggle: () => void }) {
  const long = (e.text?.length ?? 0) > CLAMP_AT || (e.text?.split("\n").length ?? 0) > 4;
  const who = e.direction === "in" ? (e.who ? `From ${e.who}` : "From the client") : `${e.who ?? "Someone"}${e.to ? ` to ${e.to}` : ""}`;
  return (
    <article className={s.item} data-direction={e.direction} data-kind={e.kind} data-guide="tender.interactions.entry">
      <div className={s.top}>
        <span className={s.chip} data-direction={e.direction}>{e.direction === "in" ? "Received" : "Sent"}</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{KIND_LABEL[e.kind]}{e.redirected ? " · redirected" : ""}</span>
        <time className={s.when} dateTime={e.at}>{fmtStamp(e.at)}</time>
      </div>
      {e.subject && <div className={s.subject}>{e.subject}</div>}
      <div className={s.line}>{who}{e.direction === "in" && e.to ? ` to ${e.to}` : ""}</div>
      {e.text && <div className={`${s.text} ${long && !expanded ? s.clamped : ""}`}>{e.text}</div>}
      {!e.text && !e.inbox_id && (e.kind === "received" || e.kind === "reply" || e.kind === "source") && (
        <div className={s.line} data-guide="tender.interactions.kept">Text is kept in the Inbox<InfoTip label="Inbox mail">{TENDER_TIPS.interactionsInbox}</InfoTip></div>
      )}
      <div className={s.actions}>
        {long && <Button variant="quiet" size="sm" style={{ minHeight: 44 }} data-guide="tender.interactions.more" aria-expanded={expanded} onClick={onToggle}>{expanded ? "Show less" : "Show more"}</Button>}
        {e.inbox_id && <Button variant="secondary" size="sm" style={{ minHeight: 44 }} href={ROUTES.inboxMessage(e.inbox_id)} data-guide="tender.interactions.open_inbox">Open in the Inbox</Button>}
      </div>
    </article>
  );
}

function Compose({ opportunityId, suggested, startSubject, onClose, onSent }: {
  opportunityId: string; suggested: string[]; startSubject: string; onClose: () => void; onSent: (message: string) => void;
}) {
  const [to, setTo] = useState(suggested[0] ?? "");
  const [subject, setSubject] = useState(startSubject);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    setError("");
    if (!isEmailAddress(to)) { setError("Enter a valid email address"); return; }
    if (!subject.trim()) { setError("Write a subject"); return; }
    if (!body.trim()) { setError("Write the message"); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/tender/interactions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: to.trim(), subject, body }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "Could not send the email"); return; }
      const intended = Array.isArray(j.intended) ? j.intended.join(", ") : to.trim();
      onSent(j.redirected ? `Email sent to the workspace test inbox (addressed to ${intended}).` : `Email sent to ${intended}.`);
    } catch {
      setError("Could not reach the server");
    } finally { setBusy(false); }
  }

  return (
    <SidePanel
      title="New email" label="New email" onClose={onClose}
      subtitle={<span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>To the client<InfoTip label="New email">{TENDER_TIPS.interactionsCompose}</InfoTip></span>}
      footer={
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" loading={busy} data-guide="tender.interactions.send" style={{ flex: "1 1 160px", minHeight: 44 }} onClick={() => void send()}>Send</Button>
          <Button variant="secondary" disabled={busy} data-guide="tender.interactions.cancel" style={{ flex: "1 1 160px", minHeight: 44 }} onClick={onClose}>Cancel</Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-guide="tender.interactions.form">
        {error && <div role="alert" style={{ background: "var(--err-bg)", border: "1px solid var(--err-line)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: "var(--err-ink)" }}>{error}</div>}
        <Field label="To" required guide="tender.interactions.to">
          <Input type="email" inputMode="email" autoComplete="off" list="tender-interactions-to" value={to} onChange={(e) => setTo(e.target.value)} maxLength={MESSAGE_LIMITS.toMax} style={{ minHeight: 44 }} />
        </Field>
        {suggested.length > 0 && <datalist id="tender-interactions-to">{suggested.map((a) => <option key={a} value={a} />)}</datalist>}
        <Field label="Subject" required guide="tender.interactions.subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={MESSAGE_LIMITS.subjectMax} style={{ minHeight: 44 }} /></Field>
        <Field label="Message" required guide="tender.interactions.body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={MESSAGE_LIMITS.bodyMax} style={{ minHeight: 160 }} /></Field>
      </div>
    </SidePanel>
  );
}
