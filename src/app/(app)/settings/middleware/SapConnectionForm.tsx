"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import type { SapPublicState } from "@/lib/connectors/sap_s4/types";
import s from "./middleware.module.css";
import { saveSapConnection, type ConnectionItem } from "./api";
import { SAP_LOGIN_CHOICES, sapFieldsFor, sapFormProblem, sapSaveBody, type SapForm, type SapSecretInput } from "./sapConnectionLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, describeError, useFlash } from "./ui";

// The SAP S/4HANA connection: one choice (the login type) and only the fields of that choice. A Communication user
// needs the API host, the user and the password; the sandbox API key needs the key alone. Secrets are never rendered
// back: a stored one shows as "Stored" and a blank field keeps it.

const EMPTY: SapForm = { auth_mode: "basic", api_host: "", username: "" };
const NO_SECRETS: SapSecretInput = { password: "", api_key: "" };

export default function SapConnectionForm({ item, onChanged, onSaved }: {
  item: ConnectionItem | null;
  connectorId: string;
  onChanged: () => Promise<void> | void;
  onSaved?: () => void;
}) {
  const state = item?.state as unknown as SapPublicState | undefined;
  const stored = state?.config ?? null;
  const fresh = !stored;
  const has = state?.secrets ?? { password: false, api_key: false };
  const fromStored = (): SapForm => (stored ? { auth_mode: stored.auth_mode, api_host: stored.auth_mode === "basic" ? stored.api_host : "", username: stored.username } : EMPTY);
  const [form, setForm] = useState<SapForm>(fromStored);
  const [secrets, setSecrets] = useState<SapSecretInput>(NO_SECRETS);
  const { dirty, markSaved } = useSettingsDirty({ form, secrets });
  const [saving, setSaving] = useState(false);
  const { flash, show } = useFlash();

  // A fresh load of the stored connection replaces what is on screen only when nothing is being edited.
  useEffect(() => {
    if (!dirty && stored) { const f = fromStored(); setForm(f); markSaved({ form: f, secrets: NO_SECRETS }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  const problem = sapFormProblem(form, secrets, has);
  const fields = sapFieldsFor(form.auth_mode);

  const save = async () => {
    setSaving(true);
    try {
      const body = sapSaveBody(form, secrets);
      await saveSapConnection(body.config, body.secrets);
      setSecrets(NO_SECRETS);
      markSaved({ form, secrets: NO_SECRETS });
      await onChanged();
      onSaved?.();
    } catch (e) {
      show(false, describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const secretField = (key: "password" | "api_key", label: string, info: string) => (
    <Field label={label} info={info} htmlFor={`sap-${key}`} style={{ marginBottom: 0 }}>
      <div className={s.secretRow}>
        <input
          id={`sap-${key}`} type="password" autoComplete="new-password" className="bpm-input" value={secrets[key]}
          placeholder={has[key] ? "Stored. Leave blank to keep it" : ""} onChange={(e) => setSecrets((x) => ({ ...x, [key]: e.target.value }))}
        />
        {has[key] && <span className={s.stored}>Stored</span>}
      </div>
    </Field>
  );

  return (
    <div className={s.stack}>
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {item?.state.last_error && item.state.status !== "connected" && <Notice tone="warn">{item.state.last_error}</Notice>}

      <div className={s.fields}>
        <Field label="Login type" info={MIDDLEWARE_TIPS.sapLogin} htmlFor="sap-auth" style={{ marginBottom: 0 }}>
          <select id="sap-auth" className="bpm-input" value={form.auth_mode} onChange={(e) => setForm((x) => ({ ...x, auth_mode: e.target.value as SapForm["auth_mode"] }))}>
            {SAP_LOGIN_CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </Field>
        {fields.includes("api_host") && (
          <div className={s.fieldFull}>
            <Field label="API host" info={MIDDLEWARE_TIPS.sapHost} htmlFor="sap-host" style={{ marginBottom: 0 }}>
              <input id="sap-host" className="bpm-input" inputMode="url" autoComplete="off" placeholder="my426318-api.s4hana.cloud.sap" value={form.api_host} onChange={(e) => setForm((x) => ({ ...x, api_host: e.target.value }))} />
            </Field>
          </div>
        )}
        {fields.includes("username") && (
          <Field label="Communication user" info={MIDDLEWARE_TIPS.sapUser} htmlFor="sap-user" style={{ marginBottom: 0 }}>
            <input id="sap-user" className="bpm-input" autoComplete="off" value={form.username} onChange={(e) => setForm((x) => ({ ...x, username: e.target.value }))} />
          </Field>
        )}
        {fields.includes("password") && <div style={{ minWidth: 0 }}>{secretField("password", "Password", MIDDLEWARE_TIPS.sapPassword)}</div>}
        {fields.includes("api_key") && <div className={s.fieldFull}>{secretField("api_key", "API key", MIDDLEWARE_TIPS.sapApiKey)}</div>}
      </div>

      <div className={`${s.row} bpm-tap`}>
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={saving || !!problem || !(dirty || fresh)} title={problem ?? undefined}>{fresh ? "Connect" : "Save"}</Button>
      </div>
    </div>
  );
}
