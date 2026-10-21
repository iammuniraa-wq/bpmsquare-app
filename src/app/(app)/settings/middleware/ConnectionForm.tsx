"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import {
  D365_AUTH_FOR_PRODUCT, D365_AUTH_LABEL, D365_PRODUCTS, D365_PRODUCT_LABEL,
  type D365AuthMode, type D365Product,
} from "@/lib/connectors/d365/types";
import s from "./middleware.module.css";
import { oauthStartUrl, saveConnection, type ConnectionConfig, type ConnectionItem, type Secrets } from "./api";
import { MIDDLEWARE_TIPS, environmentTip } from "./tips";
import { Notice, describeError, useFlash } from "./ui";

// The connection fields: login type, directory id, client id, the write-only secret and its
// expiry. A first connection also asks for the product and the address. Secrets are never
// rendered back; a stored one shows as "Stored" and a blank field keeps it. Every state
// update is functional, so two quick changes cannot undo each other.

const EMPTY: ConnectionConfig = { product: "dataverse", auth_mode: "client_secret", environment_url: "", schedule: "off", entities: {} };

type SecretKey = "client_secret" | "password" | "certificate" | "private_key";

export default function ConnectionForm({ item, connectorId, onChanged, onSaved }: {
  item: ConnectionItem | null;
  connectorId: string;
  /** Re-read everything the page shows after a save. */
  onChanged: () => Promise<void> | void;
  /** Called after a successful save (the panel leaves Edit). */
  onSaved?: () => void;
}) {
  const stored = item?.state.config ?? null;
  const fresh = !stored;
  const [cfg, setCfg] = useState<ConnectionConfig>(stored ?? EMPTY);
  const [secrets, setSecrets] = useState<Secrets>({});
  const { dirty, markSaved } = useSettingsDirty({ cfg, secrets });
  const [saving, setSaving] = useState(false);
  const { flash, show } = useFlash();
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  // A fresh load of the stored connection (after a save elsewhere) replaces what is on screen only when nothing is being edited.
  useEffect(() => {
    if (!dirty && stored) { setCfg(stored); markSaved({ cfg: stored, secrets: {} }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const set = (p: Partial<ConnectionConfig>) => setCfg((x) => ({ ...x, ...p }));
  const setSecret = (key: SecretKey, value: string) => setSecrets((x) => ({ ...x, [key]: value }));
  const has = item?.state.secrets;
  const modes = D365_AUTH_FOR_PRODUCT[cfg.product];
  const canSave = dirty || fresh;

  const save = async () => {
    setSaving(true);
    try {
      const next = await saveConnection(connectorId, cfg, secrets);
      if (next.config) setCfg(next.config);
      setSecrets({});
      markSaved({ cfg: next.config ?? cfg, secrets: {} });
      await onChanged();
      onSaved?.();
    } catch (e) {
      show(false, describeError(e));
    } finally {
      setSaving(false);
    }
  };

  const secretField = (key: SecretKey, label: string, info?: string) => (
    <Field label={label} info={info} htmlFor={`sec-${key}`}>
      <div className={s.secretRow}>
        <input
          id={`sec-${key}`} type="password" autoComplete="new-password" className="bpm-input"
          value={secrets[key] ?? ""} placeholder={has?.[key] ? "Stored. Leave blank to keep it" : ""}
          onChange={(e) => setSecret(key, e.target.value)}
        />
        {has?.[key] && <span className={s.stored}>Stored</span>}
      </div>
    </Field>
  );
  const pemField = (key: "certificate" | "private_key", label: string, ph: string) => (
    <Field label={label} info={key === "certificate" ? MIDDLEWARE_TIPS.certificate : undefined} htmlFor={`sec-${key}`}>
      <div className={s.secretRow} style={{ alignItems: "flex-start" }}>
        <textarea
          id={`sec-${key}`} rows={4} className={`bpm-input ${s.mono}`} value={secrets[key] ?? ""}
          placeholder={has?.[key] ? "Stored. Leave blank to keep it" : ph}
          onChange={(e) => setSecret(key, e.target.value)}
        />
        {has?.[key] && <span className={s.stored}>Stored</span>}
      </div>
    </Field>
  );

  return (
    <div className={s.stack}>
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {item?.state.last_error && item.state.status !== "connected" && <Notice tone="warn">{item.state.last_error}</Notice>}

      <div className={s.fields}>
        {fresh && (
          <Field label="Product" info={MIDDLEWARE_TIPS.product} htmlFor="mw-product" style={{ marginBottom: 0 }}>
            <select id="mw-product" className="bpm-input" value={cfg.product} onChange={(e) => {
              const product = e.target.value as D365Product;
              setCfg((x) => ({ ...x, product, auth_mode: D365_AUTH_FOR_PRODUCT[product].includes(x.auth_mode) ? x.auth_mode : "client_secret", entities: {} }));
            }}>
              {D365_PRODUCTS.map((p) => <option key={p} value={p}>{D365_PRODUCT_LABEL[p]}</option>)}
            </select>
          </Field>
        )}
        <Field label="Login type" info={MIDDLEWARE_TIPS.loginType} htmlFor="mw-auth" style={{ marginBottom: 0 }}>
          <select id="mw-auth" className="bpm-input" value={cfg.auth_mode} onChange={(e) => set({ auth_mode: e.target.value as D365AuthMode })}>
            {modes.map((m) => <option key={m} value={m}>{D365_AUTH_LABEL[m]}</option>)}
          </select>
        </Field>
        {fresh && (
          <div className={s.fieldFull}>
            <Field label="Address" info={environmentTip(cfg.product, cfg.auth_mode)} htmlFor="mw-env" style={{ marginBottom: 0 }}>
              <input id="mw-env" className="bpm-input" inputMode="url" value={cfg.environment_url} onChange={(e) => set({ environment_url: e.target.value })} />
            </Field>
          </div>
        )}
        {cfg.auth_mode !== "basic" && (
          <>
            <Field label="Directory ID" info={MIDDLEWARE_TIPS.directory} htmlFor="mw-dir" style={{ marginBottom: 0 }}>
              <input id="mw-dir" className="bpm-input" value={cfg.directory_id ?? ""} onChange={(e) => set({ directory_id: e.target.value })} />
            </Field>
            <Field label="Client ID" info={MIDDLEWARE_TIPS.clientId} htmlFor="mw-cid" style={{ marginBottom: 0 }}>
              <input id="mw-cid" className="bpm-input" value={cfg.client_id ?? ""} onChange={(e) => set({ client_id: e.target.value })} />
            </Field>
          </>
        )}
        {(cfg.auth_mode === "client_secret" || cfg.auth_mode === "authorization_code") && (
          <>
            <div style={{ minWidth: 0 }}>{secretField("client_secret", "Secret", MIDDLEWARE_TIPS.secret)}</div>
            <Field label="Secret expires on" info={MIDDLEWARE_TIPS.secretExpiry} htmlFor="mw-exp" style={{ marginBottom: 0 }}>
              <input id="mw-exp" type="date" className="bpm-input" value={cfg.secret_expires_on ?? ""} onChange={(e) => set({ secret_expires_on: e.target.value || undefined })} />
            </Field>
          </>
        )}
        {cfg.auth_mode === "basic" && (
          <>
            <Field label="User name" htmlFor="mw-user" style={{ marginBottom: 0 }}>
              <input id="mw-user" className="bpm-input" autoComplete="off" value={cfg.username ?? ""} onChange={(e) => set({ username: e.target.value })} />
            </Field>
            <div style={{ minWidth: 0 }}>{secretField("password", "Password or access key")}</div>
          </>
        )}
        {cfg.product !== "dataverse" && (
          <Field label={cfg.product === "fo" ? "Legal entity" : "Company"} info={MIDDLEWARE_TIPS.company} htmlFor="mw-co" style={{ marginBottom: 0 }}>
            <input id="mw-co" className="bpm-input" value={cfg.company ?? ""} onChange={(e) => set({ company: e.target.value })} />
          </Field>
        )}
        {cfg.auth_mode === "certificate" && (
          <>
            <div className={s.fieldFull}>{pemField("certificate", "Certificate (PEM)", "-----BEGIN CERTIFICATE-----")}</div>
            <div className={s.fieldFull}>{pemField("private_key", "Private key (PEM)", "-----BEGIN PRIVATE KEY-----")}</div>
          </>
        )}
        {cfg.auth_mode === "authorization_code" && (
          <div className={s.fieldFull}>
            <Field label="Redirect address" htmlFor="mw-redirect" hint="Add this under Web in the app registration" style={{ marginBottom: 0 }}>
              <input id="mw-redirect" className={`bpm-input ${s.mono}`} readOnly value={`${origin}/api/connectors/${connectorId}/oauth/callback`} onFocus={(e) => e.currentTarget.select()} />
            </Field>
          </div>
        )}
      </div>

      <div className={`${s.row} bpm-tap`}>
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={saving || !canSave}>{fresh ? "Connect" : "Save"}</Button>
        {cfg.auth_mode === "authorization_code" && stored && (
          <Button href={oauthStartUrl(connectorId)}>{item?.state.secrets.refresh_token ? "Sign in again with Microsoft" : "Connect with Microsoft"}</Button>
        )}
      </div>
    </div>
  );
}
