"use client";

import { useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InfoTip from "@/components/ui/InfoTip";
import { CheckOpt } from "@/components/ui/Opt";
import s from "./middleware.module.css";
import {
  ESTIMATE_PARTS, ESTIMATE_PART_LABEL, FENCE_PARTS, FENCE_PART_LABEL,
  previewQuote, saveRules, sendQuoteNow, sendTestQuote,
  type EstimatePart, type FencePart, type OutcomeRule, type PreviewView, type RulesPatch, type RulesView, type SendResult, type TestQuoteResult,
} from "./api";
import { useMw } from "./context";
import { MIDDLEWARE_TIPS } from "./tips";
import { ExternalIcon, Notice, ProblemNotice, Segmented, Switch, describeError, useFlash } from "./ui";
import { QuoteSelect, useQuoteOptions } from "./Pickers";

export default function OutTab() {
  const mw = useMw();
  const { rules } = mw;
  const r = rules.data;
  const { flash, show } = useFlash();
  const [saving, setSaving] = useState(false);

  if (rules.error != null && !r) return <ProblemNotice error={rules.error} onRetry={() => void rules.reload()} />;
  if (!r) return <div className={`${s.small} ${s.muted}`} role="status">Loading…</div>;

  const save = async (patch: RulesPatch) => {
    setSaving(true);
    try {
      rules.setData(await saveRules(patch));
      show(true, "Saved.");
      void mw.reloadEvidence();
    } catch (e) {
      show(false, describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const noErp = !r.product;
  return (
    <>
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {noErp && (
        <Notice tone="info" action={<Button size="sm" onClick={() => mw.goTab("connections")}>Open Connections</Button>}>
          No ERP is connected yet. Connect one first; these choices then apply to it.
        </Notice>
      )}

      <div className={s.cols2}>
        <RuleCard
          title="Quote awarded" info={MIDDLEWARE_TIPS.awarded} rule={r.rules.quote_awarded} disabled={saving}
          becomes={r.product ? `Becomes a ${(r.awarded_target ?? "quote").toLowerCase()} in ${r.product.name}` : null}
          onChange={(p) => void save({ rules: { quote_awarded: p } })}
        />
        <RuleCard
          title="Quote rejected" info={MIDDLEWARE_TIPS.rejected} rule={r.rules.quote_rejected} disabled={saving}
          becomes={r.product ? r.rejected_target : null}
          nothingToSend={r.rejected_target === "Sends nothing"}
          onChange={(p) => void save({ rules: { quote_rejected: p } })}
        />
      </div>

      <div className={s.cols2}>
        <Card title="Fence projects" info={MIDDLEWARE_TIPS.fence}>
          <div className={s.checks}>
            {FENCE_PARTS.map((p) => (
              <PartCheck key={p} label={FENCE_PART_LABEL[p]} checked={r.fence[p]} contract={r.contract.fence[p]} disabled={saving}
                onChange={(v) => void save({ fence: { [p]: v } as Partial<Record<FencePart, boolean>> })} />
            ))}
          </div>
        </Card>
        <Card title="Estimates" info={MIDDLEWARE_TIPS.estimate}>
          <div className={s.checks}>
            {ESTIMATE_PARTS.map((p) => (
              <PartCheck key={p} label={ESTIMATE_PART_LABEL[p]} checked={r.estimate[p]} contract={r.contract.estimate[p]} disabled={saving}
                onChange={(v) => void save({ estimate: { [p]: v } as Partial<Record<EstimatePart, boolean>> })} />
            ))}
          </div>
        </Card>
      </div>

      <CheckQuoteCard rules={r} />
      <TestQuoteCard connected={!noErp} onSent={() => void mw.reloadAll()} />
    </>
  );
}

function RuleCard({ title, info, rule, becomes, nothingToSend, disabled, onChange }: {
  title: string; info: string; rule: OutcomeRule; becomes: string | null; nothingToSend?: boolean; disabled: boolean;
  onChange: (p: Partial<OutcomeRule>) => void;
}) {
  return (
    <Card title={title} info={info}>
      <div className={s.stack} style={{ gap: 12 }}>
        <div className={s.ruleHead}>
          <span className={s.small}>{becomes ?? "Not connected"}</span>
          <Switch checked={rule.enabled} label={`${title}: ${rule.enabled ? "on" : "off"}`} disabled={disabled} onChange={(v) => onChange({ enabled: v })} />
        </div>
        <div className={s.row}>
          <Segmented
            label={`${title}: how it is sent`} value={rule.mode} disabled={disabled || !rule.enabled || nothingToSend === true}
            options={[{ id: "auto", label: "Automatic" }, { id: "manual", label: "Manual" }]}
            onChange={(mode) => onChange({ mode })}
          />
          <InfoTip label="Automatic or manual">{MIDDLEWARE_TIPS.mode}</InfoTip>
        </div>
      </div>
    </Card>
  );
}

/** A tick-box; when the connected product cannot take it, it is greyed and the hint it returned stays visible. */
function PartCheck({ label, checked, contract, disabled, onChange }: {
  label: string; checked: boolean; contract: { allowed: boolean; hint: string | null }; disabled: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className={s.checkItem}>
      <CheckOpt label={label} checked={contract.allowed ? checked : false} disabled={disabled || !contract.allowed} onChange={onChange} />
      {!contract.allowed && contract.hint && <p className={s.optHint}>{contract.hint}</p>}
    </div>
  );
}

// ── Preview and send one quote ──────────────────────────────────────────────

function CheckQuoteCard({ rules }: { rules: RulesView }) {
  const mw = useMw();
  const quotes = useQuoteOptions();
  const [quoteId, setQuoteId] = useState("");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const [sent, setSent] = useState<SendResult | null>(null);
  const [raw, setRaw] = useState(false);

  const connected = !!rules.product;
  const pick = (id: string) => { setQuoteId(id); setPreview(null); setSent(null); setProblem(null); setRaw(false); };

  const doPreview = async () => {
    setBusy("preview"); setSent(null); setProblem(null);
    try { setPreview(await previewQuote(quoteId)); } catch (e) { setPreview(null); setProblem(e); } finally { setBusy(null); }
  };
  const doSend = async () => {
    setBusy("send"); setProblem(null);
    try { setSent(await sendQuoteNow(quoteId)); await mw.reloadAll(); } catch (e) { setProblem(e); } finally { setBusy(null); }
  };

  return (
    <Card title="Check a quote" info={MIDDLEWARE_TIPS.sendNow}>
      <div className={s.stack}>
        <QuoteSelect value={quoteId} onChange={pick} options={quotes.data} loading={quotes.loading} error={quotes.error} onRetry={() => void quotes.reload()} />
        <div className={`${s.row} bpm-tap`}>
          <Button onClick={doPreview} loading={busy === "preview"} disabled={!quoteId || !connected || !!busy}>Preview payload</Button>
          <InfoTip label="Preview payload">{MIDDLEWARE_TIPS.preview}</InfoTip>
          <Button variant="primary" onClick={doSend} loading={busy === "send"} disabled={!quoteId || !connected || !!busy}>Send now</Button>
        </div>
        {!connected && <div className={`${s.small} ${s.muted}`}>Connect an ERP to preview or send.</div>}
        {problem != null && <ProblemNotice error={problem} />}
        {sent && <SendOutcome result={sent} />}
        {preview && <PreviewBlock preview={preview} raw={raw} onToggle={() => setRaw((r) => !r)} />}
        {quotes.data && quotes.data.length === 0 && !quotes.loading && (
          <EmptyState title="No awarded or rejected quote yet" text="Mark a Standard Quote as accepted or rejected, or send a test quote below." />
        )}
      </div>
    </Card>
  );
}

function PreviewBlock({ preview, raw, onToggle }: { preview: PreviewView; raw: boolean; onToggle: () => void }) {
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

/** What a send did, in words: the readable number and a link, or what happened and the one thing to do. */
export function SendOutcome({ result }: { result: SendResult }) {
  if (!result.ok) {
    return <Notice tone="err"><span className={s.noticeStrong}>{result.headline}</span>{result.fix ? <> {result.fix}</> : null}</Notice>;
  }
  return (
    <Notice tone="ok" action={result.link ? <Button size="sm" href={result.link} target="_blank" icon={<ExternalIcon />}>Open</Button> : undefined}>
      {result.message}
    </Notice>
  );
}

// ── Send a test quote ───────────────────────────────────────────────────────

function TestQuoteCard({ connected, onSent }: { connected: boolean; onSent: () => void }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<TestQuoteResult | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const send = async () => {
    setBusy(true); setProblem(null); setRes(null);
    try { setRes(await sendTestQuote()); onSent(); } catch (e) { setProblem(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Test" info={MIDDLEWARE_TIPS.testQuote}>
      <div className={s.stack}>
        <div className={`${s.row} bpm-tap`}>
          <Button variant="primary" onClick={send} loading={busy} disabled={!connected || busy}>Send a test quote</Button>
        </div>
        {!connected && <div className={`${s.small} ${s.muted}`}>Connect an ERP first.</div>}
        {problem != null && <ProblemNotice error={problem} />}
        {res && res.ok && (
          <Notice tone="ok" action={res.link ? <Button size="sm" href={res.link} target="_blank" icon={<ExternalIcon />}>Open</Button> : undefined}>
            <span className={s.noticeStrong}>Sent {res.ref}.</span> {res.number ? `The ERP number is ${res.number}.` : "It arrived."}
          </Notice>
        )}
        {res && !res.ok && <Notice tone="err"><span className={s.noticeStrong}>{res.headline}</span>{res.fix ? <> {res.fix}</> : null}</Notice>}
      </div>
    </Card>
  );
}
