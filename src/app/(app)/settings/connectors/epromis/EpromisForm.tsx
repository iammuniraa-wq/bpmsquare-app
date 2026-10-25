"use client";

import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { Select, Textarea } from "@/components/ui/Input";
import { EPROMIS_AUTH_LABEL, EPROMIS_AUTH_TYPES, type EpromisAuthType } from "@/lib/connectors/epromis/types";
import { EPROMIS_TIPS } from "@/lib/connectors/epromis/tips";
import s from "../../middleware/middleware.module.css";
import { TEMPLATE_TEXT, credentialLabel, type EpromisForm as Form } from "./epromisLogic";

// The ePROMIS connection form: where it is, how requests sign in, an optional company code, and the endpoint map in one
// folded box. Presentational: the screen owns the state, so the fields are tested by rendering them. The credential is
// never shown -- a stored one reads "Stored" and a blank box keeps it.

export default function EpromisForm({ form, setForm, secret, setSecret, secretStored, problem, saving, onSave, fresh }: {
  form: Form;
  setForm: (f: (prev: Form) => Form) => void;
  secret: string;
  setSecret: (v: string) => void;
  secretStored: boolean;
  problem: string | null;
  saving: boolean;
  onSave: () => void;
  fresh: boolean;
}) {
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((x) => ({ ...x, [k]: v }));
  return (
    <div className={s.stack}>
      <div className={s.fields}>
        <div className={s.fieldFull}>
          <Field label="Base URL" info={EPROMIS_TIPS.baseUrl} htmlFor="ep-url" style={{ marginBottom: 0 }}>
            <input id="ep-url" className="bpm-input" inputMode="url" autoComplete="off" placeholder="https://erp.example.com/api" value={form.base_url} onChange={(e) => set("base_url", e.target.value)} />
          </Field>
        </div>
        <Field label="Sign-in" info={EPROMIS_TIPS.authType} htmlFor="ep-auth" style={{ marginBottom: 0 }}>
          <Select id="ep-auth" value={form.auth_type} onChange={(e) => set("auth_type", e.target.value as EpromisAuthType)}>
            {EPROMIS_AUTH_TYPES.map((a) => <option key={a} value={a}>{EPROMIS_AUTH_LABEL[a]}</option>)}
          </Select>
        </Field>
        {form.auth_type === "api_key" && (
          <Field label="Header name" info={EPROMIS_TIPS.keyHeader} htmlFor="ep-header" style={{ marginBottom: 0 }}>
            <input id="ep-header" className="bpm-input" autoComplete="off" value={form.key_header} onChange={(e) => set("key_header", e.target.value)} />
          </Field>
        )}
        {form.auth_type === "basic" && (
          <Field label="User name" info={EPROMIS_TIPS.username} htmlFor="ep-user" style={{ marginBottom: 0 }}>
            <input id="ep-user" className="bpm-input" autoComplete="off" value={form.username} onChange={(e) => set("username", e.target.value)} />
          </Field>
        )}
        <div className={s.fieldFull}>
          <Field label={credentialLabel(form.auth_type)} info={EPROMIS_TIPS.credential} htmlFor="ep-secret" style={{ marginBottom: 0 }}>
            <div className={s.secretRow}>
              <input
                id="ep-secret" type="password" autoComplete="new-password" className="bpm-input" value={secret}
                placeholder={secretStored ? "Stored. Leave blank to keep it" : ""} onChange={(e) => setSecret(e.target.value)}
              />
              {secretStored && <span className={s.stored}>Stored</span>}
            </div>
          </Field>
        </div>
        <Field label="Company code" info={EPROMIS_TIPS.company} htmlFor="ep-company" style={{ marginBottom: 0 }}>
          <input id="ep-company" className="bpm-input" autoComplete="off" value={form.company_value} onChange={(e) => set("company_value", e.target.value)} />
        </Field>
        {form.company_value.trim() !== "" && (
          <Field label="Sent as" info={EPROMIS_TIPS.companySent} htmlFor="ep-company-name" style={{ marginBottom: 0 }}>
            <div className={s.row}>
              <Select aria-label="Sent in" value={form.company_in} onChange={(e) => set("company_in", e.target.value as Form["company_in"])} style={{ width: "auto" }}>
                <option value="header">Header</option>
                <option value="query">Address</option>
              </Select>
              <input id="ep-company-name" className="bpm-input" autoComplete="off" aria-label="Name" value={form.company_name} onChange={(e) => set("company_name", e.target.value)} style={{ flex: 1, minWidth: 0 }} />
            </div>
          </Field>
        )}
      </div>

      <details>
        <summary className="bpm-t-label" style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center" }}>Endpoint map</summary>
        <Field label="Endpoint map (JSON)" info={EPROMIS_TIPS.endpointMap} htmlFor="ep-map" style={{ marginTop: 8, marginBottom: 0 }}>
          <Textarea id="ep-map" rows={12} spellCheck={false} autoComplete="off" value={form.endpoints_text} onChange={(e) => set("endpoints_text", e.target.value)} style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }} />
        </Field>
        <div className={`${s.row} bpm-tap`} style={{ marginTop: 8 }}>
          <Button size="sm" onClick={() => set("endpoints_text", TEMPLATE_TEXT)}>Start from the empty template</Button>
        </div>
      </details>

      {problem && form.base_url.trim() !== "" && <div role="alert" className="bpm-t-help" style={{ color: "var(--err-ink)" }}>{problem}</div>}
      <div className={`${s.row} bpm-tap`}>
        <Button variant="primary" onClick={onSave} loading={saving} disabled={saving || !!problem}>{fresh ? "Connect" : "Save"}</Button>
      </div>
    </div>
  );
}
