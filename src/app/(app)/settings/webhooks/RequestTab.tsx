"use client";

import { useRef } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { CheckOpt } from "@/components/ui/Opt";
import s from "./webhooks.module.css";
import { ROUTES } from "@/lib/constants";
import { METHODS, type Method, type PayloadMode, type TokenChoice } from "./api";
import { getMappingDoc } from "../middleware/api";
import { generatedTemplate } from "../middleware/mappingLogic";
import { Notice, ProblemNotice, Segmented, useLoad } from "../middleware/ui";
import { DEFAULT_TEMPLATE, MAX_HEADERS, insertToken, type Draft, type HeaderDraft } from "./logic";
import { WEBHOOK_TIPS } from "./tips";
import TokenPicker from "./TokenPicker";

type Errors = Record<string, string | undefined>;

/** Request: the address, the method, the headers, the body. An Event webhook has only the address (a signed change feed). */
export default function RequestTab({ draft, onChange, errors, attention, tokens, tokensLoading, tokensError, webhook }: {
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  errors: Errors;
  /** The plain sentence for a webhook that cannot fire as it is (a migrated http:// address), shown above the address. */
  attention: string | null;
  tokens: readonly TokenChoice[];
  tokensLoading: boolean;
  tokensError: string | null;
  /** The saved webhook, when there is one: "Body from mapping" needs it (the mapping is saved against its id). */
  webhook?: { id: string; name: string } | null;
}) {
  const isCall = draft.kind === "call";
  const sendsBody = isCall && draft.method !== "GET";
  const mappable = !!webhook && draft.objectType === "standard_quotes";
  const modes: { id: PayloadMode; label: string }[] = [
    { id: "standard", label: "Standard" }, { id: "template", label: "Template" }, ...(mappable ? [{ id: "mapping" as const, label: "Body from mapping" }] : []),
  ];
  return (
    <>
      {attention && <Notice tone="warn">{attention}</Notice>}
      <Field label="Address" info={WEBHOOK_TIPS.url} htmlFor="wh-url" error={errors.url} style={{ marginBottom: 0 }}>
        <Input id="wh-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://" value={draft.url} invalid={!!errors.url} onChange={(e) => onChange({ url: e.target.value })} />
      </Field>
      {!isCall && <p className={s.greyLine}>Change feed, signed.</p>}

      {isCall && (
        <Field label="Method" info={WEBHOOK_TIPS.method} htmlFor="wh-method" style={{ marginBottom: 0 }}>
          <Select id="wh-method" value={draft.method} onChange={(e) => onChange({ method: e.target.value as Method })}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
      )}

      <HeadersEditor headers={draft.headers} onChange={(headers) => onChange({ headers })} error={errors.headers} />

      {sendsBody && (
        <section className={s.block} aria-label="Payload">
          <div className="bpm-label-row">
            <h3 className="bpm-t-label">Payload</h3><InfoTip label="Payload">{WEBHOOK_TIPS.payload}</InfoTip>
          </div>
          <Segmented
            label="Payload" value={draft.payloadMode}
            options={modes}
            onChange={(v) => onChange({ payloadMode: v, template: v === "template" && !draft.template ? DEFAULT_TEMPLATE : draft.template })}
          />
          {errors.payload_mode && <div className={s.issue} role="alert">{errors.payload_mode}</div>}
          {draft.payloadMode === "mapping" && webhook && (
            <MappingBody webhook={webhook} responseKeyPath={draft.responseKeyPath} error={errors.response_key_path} onChange={(responseKeyPath) => onChange({ responseKeyPath })} />
          )}
          {draft.payloadMode === "template" && (
            <TemplateEditor
              value={draft.template} onChange={(template) => onChange({ template })} error={errors.template}
              tokens={tokens} tokensLoading={tokensLoading} tokensError={tokensError}
            />
          )}
          <CheckOpt label="Send personal data" info={WEBHOOK_TIPS.personalData} checked={draft.allowPii} onChange={(allowPii) => onChange({ allowPii })} />
        </section>
      )}

      <Field label="Wait for an answer (seconds)" info={WEBHOOK_TIPS.timeout} htmlFor="wh-timeout" error={errors.timeout_ms} style={{ marginBottom: 0 }}>
        <Input id="wh-timeout" type="number" inputMode="numeric" min={5} max={30} step={1} value={draft.timeoutSec} invalid={!!errors.timeout_ms}
          onChange={(e) => onChange({ timeoutSec: Number(e.target.value) })} />
      </Field>
    </>
  );
}

// ── Body from mapping ───────────────────────────────────────────────────────

/** Mode "mapping": the mapping is the only store; this shows its result with a token where each value goes, and where to change it. */
export function MappingBody({ webhook, responseKeyPath, error, onChange }: {
  webhook: { id: string; name: string }; responseKeyPath: string; error?: string; onChange: (v: string) => void;
}) {
  const connection = `webhook:${webhook.id}`;
  const doc = useLoad(() => getMappingDoc("quote", connection), [connection]);
  const eng = doc.data?.engine ?? null;
  const href = `${ROUTES.settingsMiddleware}?tab=mapping&connection=${encodeURIComponent(connection)}`;
  return (
    <div className={s.block}>
      <div className="bpm-label-row">
        <span className={s.small}>{`Body from Mapping: Quote → ${webhook.name}`}</span>
        <InfoTip label="Body from mapping">{WEBHOOK_TIPS.payloadMapping}</InfoTip>
        <Link href={href} className="bpm-btn bpm-btn-secondary bpm-btn-sm">Open mapping</Link>
      </div>
      {doc.error != null && !doc.data && <ProblemNotice error={doc.error} onRetry={() => void doc.reload()} />}
      {doc.data?.pending && <Notice tone="info">{`Database update needed: run ${doc.data.pending.bundle ?? "the mapping update"} once.`}</Notice>}
      {doc.data && !doc.data.pending && (!eng || !eng.engine.active) && <Notice tone="warn">No mapping saved for this webhook yet. Build it under Mapping, then choose this.</Notice>}
      {eng?.engine.active && <pre className={s.raw} aria-label="Generated body">{generatedTemplate(eng.rows, eng.target.linesPath)}</pre>}
      <Field label="Read the id from the answer" info={WEBHOOK_TIPS.responseKey} htmlFor="wh-key-path" error={error} style={{ marginBottom: 0 }}>
        <Input id="wh-key-path" autoComplete="off" spellCheck={false} placeholder="$.data.number" value={responseKeyPath} invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      </Field>
    </div>
  );
}

// ── Headers ─────────────────────────────────────────────────────────────────

/** A stored value is never shown: it reads "Set" with Replace; a new one is typed and masked. */
export function HeadersEditor({ headers, onChange, error }: { headers: readonly HeaderDraft[]; onChange: (h: HeaderDraft[]) => void; error?: string }) {
  const set = (i: number, patch: Partial<HeaderDraft>) => onChange(headers.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const remove = (i: number) => onChange(headers.filter((_, j) => j !== i));
  const add = () => onChange([...headers, { name: "", value: "", stored: false, replacing: false }]);

  return (
    <section className={s.block} aria-label="Headers">
      <div className="bpm-label-row">
        <h3 className="bpm-t-label">Headers</h3><InfoTip label="Headers">{WEBHOOK_TIPS.headers}</InfoTip>
      </div>
      {headers.map((h, i) => {
        const keeps = h.stored && !h.replacing;
        return (
          <div key={i} className={s.headerRow}>
            <Input aria-label={`Header ${i + 1} name`} placeholder="Name" value={h.name} readOnly={h.stored} autoComplete="off" spellCheck={false} onChange={(e) => set(i, { name: e.target.value })} />
            {keeps ? (
              <div className={s.headerValue}>
                <span className={s.pill}>Set</span>
                <Button size="sm" onClick={() => set(i, { replacing: true, value: "" })} aria-label={`Replace the value of ${h.name}`}>Replace</Button>
              </div>
            ) : (
              <div className={s.headerValue}>
                <Input aria-label={`Header ${i + 1} value`} type="password" placeholder="Value" value={h.value} autoComplete="new-password" onChange={(e) => set(i, { value: e.target.value })} />
                {h.stored && <Button size="sm" onClick={() => set(i, { replacing: false, value: "" })}>Keep</Button>}
              </div>
            )}
            <Button size="sm" variant="quiet" onClick={() => remove(i)} aria-label={`Remove header ${h.name || i + 1}`}>Remove</Button>
          </div>
        );
      })}
      {error && <div className={s.issue} role="alert">{error}</div>}
      <div><Button size="sm" onClick={add} disabled={headers.length >= MAX_HEADERS}>Add a header</Button></div>
    </section>
  );
}

// ── Template ────────────────────────────────────────────────────────────────

export function TemplateEditor({ value, onChange, error, tokens, tokensLoading, tokensError }: {
  value: string; onChange: (v: string) => void; error?: string; tokens: readonly TokenChoice[]; tokensLoading: boolean; tokensError: string | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pick = (token: string) => {
    const el = ref.current;
    const at = el ? { start: el.selectionStart, end: el.selectionEnd } : { start: value.length, end: value.length };
    const next = insertToken(value, token, at.start, at.end);
    onChange(next.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(next.caret, next.caret); });
  };
  return (
    <div className={s.block}>
      <div className="bpm-label-row">
        <label htmlFor="wh-template" className="bpm-t-label">Body</label><InfoTip label="Body">{WEBHOOK_TIPS.template}</InfoTip>
      </div>
      <Textarea id="wh-template" ref={ref} className={s.template} spellCheck={false} value={value} invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      {error && <div className={s.issue} role="alert">{error}</div>}
      <TokenPicker tokens={tokens} loading={tokensLoading} error={tokensError} onPick={pick} />
    </div>
  );
}
