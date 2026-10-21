"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { Select } from "@/components/ui/Input";
import s from "./webhooks.module.css";
import { listSamples, previewWebhook, testWebhook, type PreviewRequest, type TestResult, type Webhook } from "./api";
import { Notice, ProblemNotice, useLoad } from "../middleware/ui";
import { MONITOR_HREF } from "./logic";
import { WEBHOOK_TIPS } from "./tips";

/**
 * Test: pick a real record, see the request (Preview, nothing is sent) or send it and see the answer. A Call webhook
 * needs a record; an Event webhook is pinged without one. A test is a real call and lands in the Monitor.
 */
export default function TestTab({ webhook, blocked, monitorLink }: { webhook: Webhook; blocked: boolean; monitorLink: boolean }) {
  const isCall = webhook.kind === "call";
  const samples = useLoad(async () => (isCall && webhook.object_type ? listSamples(webhook.object_type) : []), [webhook.id, webhook.object_type]);
  const [recordId, setRecordId] = useState("");
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [preview, setPreview] = useState<PreviewRequest | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [problem, setProblem] = useState<unknown>(null);

  const objectId = isCall ? recordId : null;
  const off = (isCall && !recordId) || blocked || !!busy || !!webhook.needs_attention;
  const pick = (id: string) => { setRecordId(id); setPreview(null); setResult(null); setProblem(null); };

  const doPreview = async () => {
    setBusy("preview"); setResult(null); setProblem(null);
    try { setPreview(await previewWebhook(webhook.id, objectId)); } catch (e) { setPreview(null); setProblem(e); } finally { setBusy(null); }
  };
  const doSend = async () => {
    setBusy("send"); setProblem(null);
    try { setResult(await testWebhook(webhook.id, objectId)); } catch (e) { setResult(null); setProblem(e); } finally { setBusy(null); }
  };

  return (
    <section className={s.block} aria-label="Test">
      <div className="bpm-label-row"><h3 className="bpm-t-label">Try it</h3><InfoTip label="Try it">{WEBHOOK_TIPS.test}</InfoTip></div>

      {isCall && (
        <>
          <Select aria-label="Sample record" value={recordId} disabled={samples.loading && !samples.data} onChange={(e) => pick(e.target.value)}>
            <option value="" disabled>{samples.loading && !samples.data ? "Loading…" : (samples.data ?? []).length === 0 ? "No records to try yet" : "Choose a record…"}</option>
            {(samples.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
          {samples.error != null && !samples.data && <ProblemNotice error={samples.error} onRetry={() => void samples.reload()} />}
        </>
      )}

      <div className={`${s.row} bpm-tap`}>
        {isCall && (
          <Button onClick={() => void doPreview()} loading={busy === "preview"} disabled={off} title={blocked ? "Save your changes first" : undefined}>Preview</Button>
        )}
        <Button variant="primary" onClick={() => void doSend()} loading={busy === "send"} disabled={off} title={blocked ? "Save your changes first" : undefined}>
          {isCall ? "Send test" : "Send a test ping"}
        </Button>
      </div>
      {blocked && <p className={s.greyLine}>Save your changes first.</p>}

      {problem != null && <ProblemNotice error={problem} />}
      {preview && <RequestBlock request={preview} title="Request" />}
      {result && <ResultBlock result={result} monitorLink={monitorLink} />}
    </section>
  );
}

export function RequestBlock({ request, title }: { request: PreviewRequest; title: string }) {
  return (
    <div className={s.block} aria-label={title}>
      <dl className={s.kv}>
        <dt>Request</dt><dd className={s.mono}>{request.method} {request.url}</dd>
        {request.headers.length > 0 && (<><dt>Headers</dt><dd>{request.headers.join(", ")}</dd></>)}
      </dl>
      {request.body ? <pre className={s.raw} tabIndex={0}>{request.body}</pre> : <p className={s.greyLine}>No body is sent.</p>}
    </div>
  );
}

export function ResultBlock({ result, monitorLink }: { result: TestResult; monitorLink: boolean }) {
  const code = result.response?.status ?? result.status;
  return (
    <div className={s.block}>
      <Notice
        tone={result.ok ? "ok" : "err"}
        action={result.messageId && monitorLink ? <Button size="sm" href={MONITOR_HREF}>Open in Monitor</Button> : undefined}
      >
        <strong>{result.headline ?? (result.ok ? "The call went through." : "The call did not go through.")}</strong>
        {result.fix ? <> {result.fix}</> : null}
      </Notice>
      <dl className={s.kv}>
        {code !== null && (<><dt>Answer</dt><dd>{code}</dd></>)}
        {result.durationMs !== null && (<><dt>Took</dt><dd>{result.durationMs < 1000 ? `${Math.round(result.durationMs)} ms` : `${(result.durationMs / 1000).toFixed(1)} s`}</dd></>)}
      </dl>
      {result.request && <RequestBlock request={result.request} title="Request sent" />}
      {result.response?.body ? <pre className={s.raw} tabIndex={0} aria-label="Response">{result.response.body}</pre> : null}
    </div>
  );
}
