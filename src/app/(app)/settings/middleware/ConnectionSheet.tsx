"use client";

import { useState } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import InfoTip from "@/components/ui/InfoTip";
import { FAMILY_LABEL, type ConnectionFamily, type PublicConnection, type TestResult } from "@/lib/connections/spec";
import { CONNECTION_TIPS } from "@/lib/connections/tips";
import { ROUTES } from "@/lib/constants";
import { WEBHOOKS_ROUTE } from "../webhooks/logic";
import { useWebhooksLibrary } from "../webhooks/flag";
import s from "./middleware.module.css";
import { ApiProblem, createCustomConnection, testCustomConnection, testDraftConnection, updateCustomConnection } from "./api";
import { draftFrom, draftProblem, emptyDraft, formFields, secretOf, toInput, type Draft, type FormField } from "./customConnectionLogic";
import Panel from "./Panel";
import { Notice, describeError } from "./ui";

// Add connection (and Edit): three steps in one side panel, a bottom sheet on a phone.
//   1 Pick the type   2 The few fields   3 Test, then Save
// Editing starts at step 2. A secret is typed once; a saved one shows "Stored" and a blank field keeps it.

const TYPES: { id: ConnectionFamily; line: string }[] = [
  { id: "rest", line: "Any web service with a JSON API" },
  { id: "odata", line: "Dynamics 365, SAP, Business Central" },
];

export default function ConnectionSheet({ initial, onClose, onSaved }: { initial: PublicConnection | null; onClose: () => void; onSaved: (c: PublicConnection) => Promise<void> | void }) {
  const editing = !!initial;
  const [step, setStep] = useState<1 | 2 | 3>(editing ? 2 : 1);
  const [draft, setDraft] = useState<Draft>(initial ? draftFrom(initial) : emptyDraft("rest"));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const webhooksOn = useWebhooksLibrary();

  const fields = formFields(draft.family, draft.config);
  const setConfig = (key: string, value: string) => { setDraft((d) => ({ ...d, config: { ...d.config, [key]: value } as Draft["config"] })); setResult(null); };
  const setSecret = (key: string, value: string) => { setDraft((d) => ({ ...d, secrets: { ...d.secrets, [key]: value } })); setResult(null); };
  const setName = (value: string) => setDraft((d) => ({ ...d, name: value }));

  const pickType = (family: ConnectionFamily) => { setDraft(emptyDraft(family)); setResult(null); setStep(2); };

  const next = () => {
    const p = draftProblem(draft, initial);
    if (p) { setProblem(p); return; }
    setProblem(null); setErrors({}); setStep(3);
  };

  const test = async () => {
    setTesting(true); setResult(null); setProblem(null);
    try { setResult((await testDraftConnection(toInput(draft), initial?.id)).result); }
    catch (e) { setProblem(describeError(e)); }
    finally { setTesting(false); }
  };

  const save = async () => {
    setSaving(true); setProblem(null);
    try {
      const saved = initial ? await updateCustomConnection(initial.id, toInput(draft)) : await createCustomConnection(toInput(draft));
      // Keep the answer on the row so the table shows it; a failed test here is not a failed save.
      const tested = await testCustomConnection(saved.connection.id).catch(() => null);
      await onSaved(tested?.connection ?? saved.connection);
      onClose();
    } catch (e) {
      if (e instanceof ApiProblem && e.errors.length) {
        const m: Record<string, string> = {};
        for (const x of e.errors) if (x.field) m[x.field] = x.message;
        setErrors(m); setStep(2);
      }
      setProblem(describeError(e));
    } finally { setSaving(false); }
  };

  const stored = (f: FormField) => f.kind === "secret" && !!initial && initial.config.auth === draft.config.auth && !!initial.secretsSet[f.key];

  const control = (f: FormField) => {
    const id = `cc-${f.key}`;
    if (f.kind === "select") {
      return (
        <select id={id} className="bpm-input" value={String((draft.config as Record<string, unknown>)[f.key] ?? f.options[0].value)} onChange={(e) => setConfig(f.key, e.target.value)}>
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    if (f.kind === "secret") {
      return (
        <div className={s.secretRow}>
          <input id={id} type="password" autoComplete="new-password" className="bpm-input" value={draft.secrets[f.key] ?? ""} placeholder={stored(f) ? "Stored. Leave blank to keep it" : ""} onChange={(e) => setSecret(f.key, e.target.value)} />
          {stored(f) && <span className={s.stored}>Stored</span>}
        </div>
      );
    }
    const value = f.target === "name" ? draft.name : String((draft.config as Record<string, unknown>)[f.key] ?? "");
    return (
      <input
        id={id} className="bpm-input" inputMode={f.kind === "url" ? "url" : undefined} autoComplete="off" spellCheck={false} placeholder={f.placeholder}
        aria-invalid={errors[f.key] ? true : undefined} value={value} onChange={(e) => (f.target === "name" ? setName(e.target.value) : setConfig(f.key, e.target.value))}
      />
    );
  };

  const title = editing ? `Edit ${initial!.name}` : "Add connection";
  const subtitle = step === 1 ? "Step 1 of 3 · Choose a type" : `Step ${step} of 3 · ${FAMILY_LABEL[draft.family]}`;
  const needsSecret = secretOf(draft.config);

  return (
    <Panel
      title={title} subtitle={subtitle} onClose={onClose} label={title}
      footer={
        step === 1 ? null : (
          <div className={`${s.row} bpm-tap`}>
            {step === 2 && <>{!editing && <Button onClick={() => setStep(1)}>Back</Button>}<Button variant="primary" data-guide="connections.next" onClick={next}>Next</Button></>}
            {step === 3 && (
              <>
                <Button onClick={() => setStep(2)} disabled={saving}>Back</Button>
                <Button data-guide="connections.test" onClick={() => void test()} loading={testing} disabled={testing || saving}>Test</Button>
                <Button variant="primary" data-guide="connections.save" onClick={() => void save()} loading={saving} disabled={saving || testing}>{result?.ok ? "Save" : "Save without a passing test"}</Button>
              </>
            )}
          </div>
        )
      }
    >
      {problem && <Notice tone="err">{problem}</Notice>}

      {step === 1 && (
        <div className={s.stack} data-guide="connections.types">
          <div className="bpm-label-row"><h3 className="bpm-t-label">Type</h3><InfoTip label="Type">{CONNECTION_TIPS.type}</InfoTip></div>
          <div className={s.typeGrid}>
            {TYPES.map((t) => (
              <button key={t.id} type="button" className={s.cardRow} onClick={() => pickType(t.id)} data-guide={`connections.type.${t.id}`}>
                <span className={s.fieldName}>{FAMILY_LABEL[t.id]}</span>
                <span className={`${s.small} ${s.muted}`}>{t.line}</span>
              </button>
            ))}
            {webhooksOn && (
              <Link href={WEBHOOKS_ROUTE} className={s.cardRow} data-guide="connections.type.webhook">
                <span className={s.fieldName}>Webhook</span>
                <span className={`${s.small} ${s.muted}`}>Send or receive events</span>
              </Link>
            )}
            <Link href={ROUTES.settingsConnectors} className={s.cardRow} data-guide="connections.type.email">
              <span className={s.fieldName}>Email (IMAP, SMTP)</span>
              <span className={`${s.small} ${s.muted}`}>Your own mailbox</span>
            </Link>
          </div>
          <div className={s.row}>
            <span className={`${s.small} ${s.muted}`}>Webhook and Email open their own page</span>
            <InfoTip label="Webhook and Email">{webhooksOn ? CONNECTION_TIPS.webhooks : CONNECTION_TIPS.email}</InfoTip>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className={s.fields} data-guide="connections.fields">
          {fields.map((f) => (
            <div key={f.key} className={f.key === "name" || f.key === "base_url" || f.key === "token_url" ? s.fieldFull : undefined}>
              <Field label={f.label} info={f.tip ? CONNECTION_TIPS[f.tip] : undefined} htmlFor={`cc-${f.key}`} error={errors[f.key]} hint={"optional" in f && f.optional ? "Optional" : undefined} style={{ marginBottom: 0 }}>
                {control(f)}
              </Field>
            </div>
          ))}
        </div>
      )}

      {step === 3 && (
        <div className={s.stack}>
          <dl className={s.kv}>
            <dt>Name</dt><dd>{draft.name}</dd>
            <dt>Type</dt><dd>{FAMILY_LABEL[draft.family]}</dd>
            <dt>Address</dt><dd className={s.mono}>{draft.config.base_url}</dd>
            <dt>Sign in</dt><dd>{needsSecret ? (draft.secrets[needsSecret] ? "New secret entered" : "Stored secret") : "No sign-in"}</dd>
          </dl>
          <div className="bpm-label-row"><span className="bpm-t-label">Test</span><InfoTip label="Test">{CONNECTION_TIPS.test}</InfoTip></div>
          {!result && !testing && <p className={`${s.small} ${s.muted}`} role="status">Not tested yet. Press Test.</p>}
          {result && (
            <Notice tone={result.ok ? "ok" : "err"} live>
              <span className={s.noticeStrong}>{result.message}</span>
              {result.fix ? <> {result.fix}</> : null}
              {result.reference ? <span className={`${s.small} ${s.mono}`}> Reference: {result.reference}</span> : null}
            </Notice>
          )}
        </div>
      )}
    </Panel>
  );
}
