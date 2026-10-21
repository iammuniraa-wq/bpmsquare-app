"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import MoreMenu from "@/components/ui/MoreMenu";
import { CheckOpt } from "@/components/ui/Opt";
import type { D365EntityKey } from "@/lib/connectors/d365/types";
import s from "./middleware.module.css";
import {
  getMapping, getPriceLists, previewQuote, saveConnection, saveDocument, sendQuoteNow, sendTestQuote,
  type ConnectionConfig, type DocumentView, type PreviewView, type SendResult, type TestQuoteResult,
} from "./api";
import { useMw } from "./context";
import { draftFromDocument, draftPatch, draftProblem, showsFallbackPriceList, targetOptions, type DocDraft } from "./documentsLogic";
import { buildLinks, type LinkRow } from "./linksLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { ExternalIcon, Notice, ProblemNotice, Switch, describeError, useFlash, useLoad } from "./ui";
import { QuoteSelect, useQuoteOptions } from "./Pickers";
import { SendOutcome } from "./SendOutcome";
import Panel from "./Panel";

// Links: ONE table, one row per object-to-object link. BPMSquare | arrow | ERP | Runs | On.
// A quote goes to the ERP only when it is awarded; a rejected quote never leaves. An outbound
// row opens a small panel (Create as, Include, Try it, Save); an inbound row is only its On switch.

export default function LinksTab() {
  const mw = useMw();
  const connected = mw.health.data?.connection.connected === true;
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<TestQuoteResult | null>(null);
  const { flash, show } = useFlash();
  const docs = mw.documents;

  if (docs.error != null && !docs.data) return <ProblemNotice error={docs.error} onRetry={() => void docs.reload()} />;
  if (!docs.data) return <div className={`${s.small} ${s.muted}`} role="status">Loading…</div>;
  const entities = mw.sync.data && mw.sync.data.connected ? mw.sync.data.entities : [];
  const rows = buildLinks(docs.data.documents, entities);
  const open = rows.find((r) => r.id === openId && r.kind === "out")?.doc ?? null;

  const toggle = async (row: LinkRow, enabled: boolean) => {
    setBusy(row.id);
    try {
      if (row.kind === "out" && row.doc) {
        const next = await saveDocument(row.doc.key, { enabled });
        docs.setData({ documents: docs.data!.documents.map((d) => (d.key === next.key ? next : d)) });
      } else if (row.entity) {
        await setEntityEnabled(mw.connection?.state.config ?? null, mw.connector.id, row.entity.key, enabled);
      }
      await mw.reloadAll();
    } catch (e) { show(false, describeError(e)); } finally { setBusy(null); }
  };
  const sendTest = async () => {
    setBusy("test"); setTest(null);
    try { setTest(await sendTestQuote()); await mw.reloadAll(); } catch (e) { show(false, describeError(e)); } finally { setBusy(null); }
  };

  return (
    <>
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {test && test.ok && (
        <Notice tone="ok" action={test.link ? <Button size="sm" href={test.link} target="_blank" icon={<ExternalIcon />}>Open</Button> : undefined}>
          <span className={s.noticeStrong}>Sent {test.ref}.</span> {test.number ? `The ERP number is ${test.number}.` : "It arrived."}
        </Notice>
      )}
      {test && !test.ok && <Notice tone="err"><span className={s.noticeStrong}>{test.headline}</span>{test.fix ? <> {test.fix}</> : null}</Notice>}

      <div className={s.rowBetween}>
        <span className="bpm-label-row"><h2 className="bpm-t-section">Links</h2><InfoTip label="Links">{MIDDLEWARE_TIPS.links}</InfoTip></span>
      </div>
      <div className={s.listCard}>
        <LinksTable rows={rows} connected={connected} busy={busy} onOpen={(r) => setOpenId(r.id)} onToggle={(r, v) => void toggle(r, v)} onTest={() => void sendTest()} />
      </div>

      {open && (
        <LinkPanel
          key={open.key} doc={open} connected={connected} onClose={() => setOpenId(null)}
          onSaved={async (next) => { docs.setData({ documents: docs.data!.documents.map((d) => (d.key === next.key ? next : d)) }); await mw.reloadAll(); }}
        />
      )}
    </>
  );
}

/** Switch an inbound entity on or off. The entity's stored settings are kept; a first switch-on starts from the standard ones. */
async function setEntityEnabled(cfg: ConnectionConfig | null, connectorId: string, key: D365EntityKey, enabled: boolean): Promise<void> {
  if (!cfg) throw new Error("Connect your ERP first.");
  let base = cfg.entities[key];
  if (!base) {
    const m = await getMapping();
    base = m.connected ? m.entities[key] ?? undefined : undefined;
  }
  if (!base) throw new Error("This is not available for your ERP.");
  await saveConnection(connectorId, { ...cfg, entities: { ...cfg.entities, [key]: { ...base, enabled } } });
}

// ── The table ───────────────────────────────────────────────────────────────

export function LinksTable({ rows, connected, busy, onOpen, onToggle, onTest }: {
  rows: readonly LinkRow[]; connected: boolean; busy: string | null;
  onOpen: (r: LinkRow) => void; onToggle: (r: LinkRow, enabled: boolean) => void; onTest: () => void;
}) {
  if (rows.length === 0) return <EmptyState title="Nothing to link yet" text="Links appear here as soon as your ERP is connected." />;
  return (
    <table className={`${s.docTable} ${s.linksTable}`}>
      <thead>
        <tr><th>BPMSquare</th><th><span className="bpm-sr-only">Direction</span></th><th>ERP</th><th>Runs</th><th>On</th><th><span className="bpm-sr-only">Actions</span></th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={s.docRow}>
            <td data-label="BPMSquare">
              {r.kind === "out"
                ? <button type="button" className={s.docOpen} onClick={() => onOpen(r)} aria-label={`${r.bpm}: change what it becomes in the ERP`}><span className={s.fieldName}>{r.bpm}</span></button>
                : <span className={s.fieldName}>{r.bpm}</span>}
            </td>
            <td className={s.arrowCell} data-label="Direction"><span aria-label={r.kind === "out" ? "goes to" : "comes from"} role="img">{r.kind === "out" ? "→" : "←"}</span></td>
            <td data-label="ERP">{r.erp}</td>
            <td data-label="Runs">{r.runs}</td>
            <td data-label="On">
              <Switch checked={r.enabled} label={`${r.bpm} ${r.kind === "out" ? "to" : "from"} ${r.erp}: ${r.enabled ? "on" : "off"}`} disabled={busy === r.id || !connected} onChange={(v) => onToggle(r, v)} />
            </td>
            <td className={s.docMenu}>
              {r.kind === "out" ? <MoreMenu label={`More for ${r.bpm}`} items={[{ label: "Send a test quote", onSelect: onTest, hidden: !connected }]} /> : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────

export function LinkPanel({ doc, connected, onClose, onSaved }: {
  doc: DocumentView; connected: boolean; onClose: () => void; onSaved: (next: DocumentView) => Promise<void> | void;
}) {
  const mw = useMw();
  const cfg = mw.connection?.state.config ?? null;
  const productKey = mw.health.data?.connection.product?.key ?? cfg?.product ?? null;
  // The stored fallback lives on the document; an older server only had it on the connection.
  const storedPriceList = doc.fallbackPriceListId ?? cfg?.price_list_id ?? "";
  const [draft, setDraft] = useState<DocDraft>(() => draftFromDocument(doc, storedPriceList));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(draftFromDocument(doc, storedPriceList)); }, [doc, storedPriceList]);

  const fallback = showsFallbackPriceList(productKey, draft.target, doc);
  const lists = useLoad(async () => (fallback ? getPriceLists() : null), [fallback]);
  const patch = draftPatch(doc, draft, storedPriceList);
  if (!fallback) delete patch.fallbackPriceListId;
  const dirty = Object.keys(patch).length > 0;
  const problem = draftProblem(doc, draft);
  const needsFirstSave = !doc.confirmedAt;
  const options = targetOptions(doc);

  const save = async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      const next = dirty || needsFirstSave ? await saveDocument(doc.key, patch) : doc;
      await onSaved(next);
      setSaved(true);
    } catch (e) { setError(describeError(e)); } finally { setSaving(false); }
  };

  return (
    <Panel
      title="Standard Quote" subtitle="Goes to the ERP when it is awarded" onClose={onClose}
      footer={
        <>
          {problem && <div className={s.issue} role="alert">{problem}</div>}
          {error && <div className={s.issue} role="alert">{error}</div>}
          {saved && !dirty && <span className={`${s.small} ${s.muted}`} role="status">Saved.</span>}
          <Button variant="primary" onClick={() => void save()} loading={saving} disabled={saving || !!problem || (!dirty && !needsFirstSave)}>Save</Button>
        </>
      }
    >
      <section className={s.block} aria-label="Create as">
        <Field label="Create as" info={MIDDLEWARE_TIPS.createAs} htmlFor="doc-target" style={{ marginBottom: 0 }}>
          <select id="doc-target" className="bpm-input" value={draft.target} onChange={(e) => setDraft((x) => ({ ...x, target: e.target.value }))}>
            {options.map((o) => <option key={o.key} value={o.key} disabled={o.disabled && o.key !== draft.target}>{o.label}{o.disabled ? " (not ready)" : ""}</option>)}
          </select>
        </Field>
        {options.filter((o) => o.disabled && o.hint).map((o) => <p key={o.key} className={s.greyLine}>{o.label}: {o.hint}</p>)}
        {fallback && (
          <Field label="If the customer has none: price list" info={MIDDLEWARE_TIPS.fallbackPriceList} htmlFor="doc-pl" style={{ marginBottom: 0 }}>
            <select id="doc-pl" className="bpm-input" value={draft.priceList} disabled={!lists.data} onChange={(e) => setDraft((x) => ({ ...x, priceList: e.target.value }))}>
              <option value="" disabled>{lists.data ? "Choose…" : "Loading…"}</option>
              {(lists.data?.items ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              {draft.priceList && !(lists.data?.items ?? []).some((i) => i.id === draft.priceList) && lists.data ? <option value={draft.priceList}>Saved choice (not in the list now)</option> : null}
            </select>
          </Field>
        )}
      </section>

      <section className={s.block} aria-label="Include">
        <div className="bpm-label-row"><h3 className="bpm-t-label">Include</h3><InfoTip label="Include">{MIDDLEWARE_TIPS.include}</InfoTip></div>
        <div className={s.includeList}>
          {doc.include.map((i) => (
            <div key={i.key} className={s.checkItem}>
              <CheckOpt
                label={i.label} checked={i.allowed ? draft.include[i.key] ?? i.on : false} disabled={!i.allowed}
                onChange={(v) => setDraft((x) => ({ ...x, include: { ...x.include, [i.key]: v } }))}
              />
              {!i.allowed && i.hint ? <span className={s.greyLine} style={{ marginInlineStart: 24 }}>{i.hint}</span> : null}
            </div>
          ))}
        </div>
      </section>

      <TryIt connected={connected} blocked={dirty} />
    </Panel>
  );
}

// ── Try it ──────────────────────────────────────────────────────────────────

export function TryIt({ connected, blocked }: { connected: boolean; blocked: boolean }) {
  const mw = useMw();
  const quotes = useQuoteOptions();
  const [quoteId, setQuoteId] = useState("");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [sent, setSent] = useState<SendResult | null>(null);
  const [raw, setRaw] = useState(false);

  const pick = (id: string) => { setQuoteId(id); setPreview(null); setSent(null); setProblem(null); setRaw(false); };
  const off = !quoteId || !connected || blocked || !!busy;
  const doPreview = async () => {
    setBusy("preview"); setSent(null); setProblem(null);
    try { setPreview(await previewQuote(quoteId)); } catch (e) { setPreview(null); setProblem(e); } finally { setBusy(null); }
  };
  const doSend = async () => {
    setBusy("send"); setProblem(null);
    try { setSent(await sendQuoteNow(quoteId)); await mw.reloadAll(); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  return (
    <section className={s.block} aria-label="Try it">
      <div className="bpm-label-row"><h3 className="bpm-t-label">Try it</h3><InfoTip label="Try it">{MIDDLEWARE_TIPS.tryIt}</InfoTip></div>
      <QuoteSelect value={quoteId} onChange={pick} options={quotes.data} loading={quotes.loading} error={quotes.error} onRetry={() => void quotes.reload()} />
      <div className={`${s.row} bpm-tap`}>
        <Button onClick={doPreview} loading={busy === "preview"} disabled={off} title={blocked ? "Save your changes first" : undefined}>Preview</Button>
        <Button variant="primary" onClick={doSend} loading={busy === "send"} disabled={off} title={blocked ? "Save your changes first" : undefined}>Send a quote now</Button>
      </div>
      {!connected && <p className={s.greyLine}>Connect an ERP to preview or send.</p>}
      {problem != null && <ProblemNotice error={problem} />}
      {sent && <SendOutcome result={sent} />}
      {preview && <PreviewBlock preview={preview} raw={raw} onToggle={() => setRaw((r) => !r)} />}
    </section>
  );
}

export function PreviewBlock({ preview, raw, onToggle }: { preview: PreviewView; raw: boolean; onToggle: () => void }) {
  return (
    <div className={s.stack} style={{ gap: 10 }}>
      <ul className={s.words}>{preview.words.map((w, i) => <li key={i}>{w}</li>)}</ul>
      {preview.problems.length > 0 && (
        <Notice tone="warn">
          {preview.problems.map((p) => <div key={p.code}><span className={s.noticeStrong}>{p.message}</span> {p.fix}</div>)}
        </Notice>
      )}
      {preview.body && (
        <>
          <div><Button size="sm" aria-pressed={raw} onClick={onToggle}>{raw ? "Hide the exact body" : "Show the exact body"}</Button></div>
          {raw && <pre className={`${s.raw} ${s.mono}`} tabIndex={0}>{JSON.stringify(preview.body, null, 2)}</pre>}
        </>
      )}
    </div>
  );
}
