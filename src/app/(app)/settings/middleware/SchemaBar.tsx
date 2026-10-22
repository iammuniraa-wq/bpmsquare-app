"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { CheckOpt } from "@/components/ui/Opt";
import s from "./middleware.module.css";
import type { SchemaOperation, SchemaRequest, SchemaSource } from "./api";
import { changeChips, parseManualText, type BarLine } from "./mappingLogic";
import Panel from "./Panel";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, Segmented } from "./ui";

/** The one compact bar that holds everything about the target's field list. Plain props, so a test renders it as it is. */
/** Without `onFetch` (a preset-only connector) the bar is the count alone. */
export function SchemaBar({ bar, automatic, busy, onFetch }: { bar: BarLine; automatic: boolean; busy: boolean; onFetch?: () => void }) {
  const chips = changeChips(bar);
  return (
    <div className={s.schemaBar} role="group" aria-label="Target fields">
      <span className={s.schemaText}>
        <strong>{bar.count}</strong>
        {bar.fetched ? <span className={s.muted}>{` · fetched ${bar.fetched}`}</span> : automatic ? <span className={s.muted}> · fetched automatically</span> : null}
      </span>
      {chips.map((c) => <span key={c} className={c.endsWith("missing") ? `${s.chipFlag} ${s.chipGone}` : s.chipFlag}>{c}</span>)}
      <span className={s.schemaSpacer} />
      {onFetch && <InfoTip label="Fetch fields">{MIDDLEWARE_TIPS.fetchFields}</InfoTip>}
      {onFetch && <Button size="sm" onClick={onFetch} loading={busy}>Fetch fields</Button>}
    </div>
  );
}

const SOURCES: { id: SchemaSource; label: string }[] = [
  { id: "openapi", label: "OpenAPI" }, { id: "odata", label: "OData" }, { id: "sample", label: "Sample" }, { id: "manual", label: "Add fields" },
];

/** Where an "any system" connection gets its field list. */
export function FetchPanel({ webhook, busy, error, message, operations, onFetch, onClose }: {
  webhook: boolean; busy: boolean; error: string | null; message: string | null; operations: SchemaOperation[]; onFetch: (r: SchemaRequest) => void; onClose: () => void;
}) {
  const [source, setSource] = useState<SchemaSource>("openapi");
  const [url, setUrl] = useState("");
  const [sample, setSample] = useState("");
  const [manual, setManual] = useState("");
  const [linesPath, setLinesPath] = useState("");
  const [headers, setHeaders] = useState(false);
  const [op, setOp] = useState("");
  const [local, setLocal] = useState<string | null>(null);

  const go = () => {
    setLocal(null);
    if (source === "sample") return onFetch({ source, sample });
    if (source === "manual") {
      const m = parseManualText(manual, linesPath);
      if (m.problem) { setLocal(m.problem); return; }
      return onFetch({ source, fields: m.fields, ...(linesPath.trim() ? { linesPath: linesPath.trim() } : {}) });
    }
    const chosen = operations.find((o) => `${o.method} ${o.path}` === op);
    onFetch({ source, url: url.trim(), ...(webhook && headers ? { sendWebhookHeaders: true } : {}), ...(chosen ? { operation: { method: chosen.method, path: chosen.path } } : {}) });
  };
  const ready = source === "sample" ? sample.trim() !== "" : source === "manual" ? manual.trim() !== "" : url.trim() !== "";

  return (
    <Panel
      title="Fetch fields" onClose={onClose}
      footer={<Button variant="primary" onClick={go} loading={busy} disabled={!ready}>Fetch fields</Button>}
    >
      <Segmented label="Where the field list comes from" value={source} options={SOURCES} onChange={(v) => { setSource(v); setLocal(null); }} />
      {(source === "openapi" || source === "odata") && (
        <>
          <Field label={source === "openapi" ? "Address of the OpenAPI file" : "Address of $metadata"} htmlFor="sc-url" style={{ marginBottom: 0 }}>
            <Input id="sc-url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          {webhook && <CheckOpt label="Send the webhook's headers" info={MIDDLEWARE_TIPS.sendHeaders} checked={headers} onChange={setHeaders} />}
          {operations.length > 0 && (
            <Field label={source === "odata" ? "Which entity set" : "Which call"} htmlFor="sc-op" style={{ marginBottom: 0 }}>
              <Select id="sc-op" value={op} onChange={(e) => setOp(e.target.value)}>
                <option value="">Choose…</option>
                {operations.map((o) => <option key={`${o.method} ${o.path}`} value={`${o.method} ${o.path}`}>{o.method} {o.path}{o.summary ? ` · ${o.summary}` : ""}</option>)}
              </Select>
            </Field>
          )}
        </>
      )}
      {source === "sample" && (
        <Field label="Sample JSON" htmlFor="sc-sample" style={{ marginBottom: 0 }}>
          <Textarea id="sc-sample" spellCheck={false} rows={8} value={sample} onChange={(e) => setSample(e.target.value)} />
        </Field>
      )}
      {source === "manual" && (
        <>
          <Field label="Fields" info={MIDDLEWARE_TIPS.manualFields} htmlFor="sc-manual" style={{ marginBottom: 0 }}>
            <Textarea id="sc-manual" spellCheck={false} rows={8} placeholder={"name text*\ncity text\ntotal number"} value={manual} onChange={(e) => setManual(e.target.value)} />
          </Field>
          <Field label="Lines block name (optional)" htmlFor="sc-lines" style={{ marginBottom: 0 }}>
            <Input id="sc-lines" autoComplete="off" spellCheck={false} placeholder="items" value={linesPath} onChange={(e) => setLinesPath(e.target.value)} />
          </Field>
        </>
      )}
      {message && operations.length > 0 && <Notice tone="info">{message}</Notice>}
      {(local || error) && <Notice tone="err">{local ?? error}</Notice>}
    </Panel>
  );
}
