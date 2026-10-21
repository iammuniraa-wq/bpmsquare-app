"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import { useFeel } from "@/components/FeelProvider";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";
import {
  D365_AUTH_FOR_PRODUCT, D365_AUTH_LABEL, D365_PRODUCTS, D365_PRODUCT_LABEL,
  type D365AuthMode, type D365Product,
} from "@/lib/connectors/d365/types";
import s from "./middleware.module.css";
import { disconnect, oauthStartUrl, saveConnection, testConnection, type ConnectionConfig, type ConnectionItem, type Secrets } from "./api";
import { MIDDLEWARE_TIPS, environmentTip } from "./tips";
import { Notice, describeError, useFlash } from "./ui";

// The connection form, reused from the old connector screen's logic: product,
// login type, environment, ids and the write-only secret. Secrets are never
// rendered back; a stored one shows as "Stored" and a blank field keeps it.

const EMPTY: ConnectionConfig = { product: "dataverse", auth_mode: "client_secret", environment_url: "", schedule: "off", entities: {} };

type SecretKey = "client_secret" | "password" | "certificate" | "private_key";

export default function ConnectionForm({ item, connectorId, onChanged, authReturn }: {
  item: ConnectionItem | null;
  connectorId: string;
  /** Re-read everything the page shows after a save, a test or a disconnect. */
  onChanged: () => Promise<void> | void;
  /** A message from coming back from the sign-in (success or the reason it failed). */
  authReturn: { ok: boolean; text: string } | null;
}) {
  const { confirm } = useFeel();
  const stored = item?.state.config ?? null;
  const [cfg, setCfg] = useState<ConnectionConfig>(stored ?? EMPTY);
  const [secrets, setSecrets] = useState<Secrets>({});
  const { dirty, markSaved } = useSettingsDirty({ cfg, secrets });
  const [busy, setBusy] = useState<"save" | "test" | "disconnect" | null>(null);
  const { flash, show } = useFlash();
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  // A fresh load of the stored connection (after a save elsewhere) replaces what is on screen only when nothing is being edited.
  useEffect(() => {
    if (!dirty && stored) { setCfg(stored); markSaved({ cfg: stored, secrets: {} }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);
  useEffect(() => { if (authReturn) show(authReturn.ok, authReturn.text); }, [authReturn, show]);

  const set = (p: Partial<ConnectionConfig>) => setCfg((x) => ({ ...x, ...p }));
  const has = item?.state.secrets;
  const connected = item?.state.status === "connected";
  const modes = D365_AUTH_FOR_PRODUCT[cfg.product];

  const save = async () => {
    setBusy("save");
    try {
      const next = await saveConnection(connectorId, cfg, secrets);
      if (next.config) setCfg(next.config);
      setSecrets({});
      markSaved({ cfg: next.config ?? cfg, secrets: {} });
      show(true, "Saved. Press Test connection to check it.");
      await onChanged();
    } catch (e) {
      show(false, describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      const r = await testConnection(connectorId);
      show(true, r.message ?? "The connection works.");
    } catch (e) {
      show(false, describeError(e));
    } finally {
      setBusy(null);
      await onChanged();
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: "Disconnect?", body: "Records already synced stay in BPMSquare. Nothing new goes out until you connect again.", confirmLabel: "Disconnect", tone: "danger" }))) return;
    setBusy("disconnect");
    try {
      await disconnect(connectorId);
      setCfg(EMPTY);
      setSecrets({});
      markSaved({ cfg: EMPTY, secrets: {} });
      show(true, "Disconnected.");
    } catch (e) {
      show(false, describeError(e));
    } finally {
      setBusy(null);
      await onChanged();
    }
  };

  const secretField = (key: SecretKey, label: string, info?: string) => (
    <Field label={label} info={info} htmlFor={`sec-${key}`}>
      <div className={s.secretRow}>
        <input
          id={`sec-${key}`} type="password" autoComplete="new-password" className="bpm-input"
          value={secrets[key] ?? ""} placeholder={has?.[key] ? "Stored. Leave blank to keep it" : ""}
          onChange={(e) => setSecrets({ ...secrets, [key]: e.target.value })}
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
          onChange={(e) => setSecrets({ ...secrets, [key]: e.target.value })}
        />
        {has?.[key] && <span className={s.stored}>Stored</span>}
      </div>
    </Field>
  );

  return (
    <div className={s.stack}>
      <SettingsSave dirty={dirty} saving={busy === "save"} onSave={save} />
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {item?.state.last_error && !connected && <Notice tone="warn">{item.state.last_error}</Notice>}

      <div className={s.fields}>
        <Field label="Product" info={MIDDLEWARE_TIPS.product} htmlFor="mw-product" style={{ marginBottom: 0 }}>
          <select id="mw-product" className="bpm-input" value={cfg.product} onChange={(e) => {
            const product = e.target.value as D365Product;
            set({ product, auth_mode: D365_AUTH_FOR_PRODUCT[product].includes(cfg.auth_mode) ? cfg.auth_mode : "client_secret", entities: {} });
          }}>
            {D365_PRODUCTS.map((p) => <option key={p} value={p}>{D365_PRODUCT_LABEL[p]}</option>)}
          </select>
        </Field>
        <Field label="Login type" info={MIDDLEWARE_TIPS.loginType} htmlFor="mw-auth" style={{ marginBottom: 0 }}>
          <select id="mw-auth" className="bpm-input" value={cfg.auth_mode} onChange={(e) => set({ auth_mode: e.target.value as D365AuthMode })}>
            {modes.map((m) => <option key={m} value={m}>{D365_AUTH_LABEL[m]}</option>)}
          </select>
        </Field>
        <div className={s.fieldFull}>
          <Field label="Environment" info={environmentTip(cfg.product, cfg.auth_mode)} htmlFor="mw-env" style={{ marginBottom: 0 }}>
            <input id="mw-env" className="bpm-input" inputMode="url" value={cfg.environment_url} onChange={(e) => set({ environment_url: e.target.value })} />
          </Field>
        </div>
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
        <Button onClick={test} loading={busy === "test"} disabled={!!busy || !stored}>Test connection</Button>
        {cfg.auth_mode === "authorization_code" && stored && (
          <Button href={oauthStartUrl(connectorId)}>{item?.state.secrets.refresh_token ? "Sign in again with Microsoft" : "Connect with Microsoft"}</Button>
        )}
        {stored && <Button variant="danger" onClick={remove} loading={busy === "disconnect"} disabled={!!busy}>Disconnect</Button>}
      </div>
    </div>
  );
}
