"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { c } from "@/lib/theme";
import { cardStyle } from "@/components/Shell";
import Pill from "@/components/Pill";
import { inp, lbl, btnPrimary, btnGhost, fmtDateTime } from "@/components/rfq/rfqUi";
import {
  D365_PRODUCTS, D365_PRODUCT_LABEL, D365_AUTH_LABEL, D365_AUTH_FOR_PRODUCT, D365_ENTITY_KEYS, D365_ENTITY_LABEL, D365_ENTITY_TARGET,
  type D365Config, type D365EntityConfig, type D365EntityKey, type D365PublicState, type D365Product, type D365AuthMode,
} from "@/lib/connectors/d365/types";
import { entityConfig } from "@/lib/connectors/d365/catalog";
import { SettingsSave } from "@/components/settings/SettingsHeaderActions";
import { useSettingsDirty } from "@/components/settings/useSettingsDirty";

type Run = {
  id: string; entity: string; direction: "pull" | "push"; trigger: string; status: string; started_at: string; finished_at: string | null;
  counts: Record<string, number>; error: string | null; issues: string[];
};

const EMPTY: D365Config = { product: "dataverse", auth_mode: "client_secret", environment_url: "", schedule: "off", entities: {} };

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** "name = OrganizationName" lines <-> a field map. */
const mapToText = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `${k} = ${v}`).join("\n");
function textToMap(t: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of t.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export default function D365Client() {
  const [state, setState] = useState<D365PublicState | null>(null);
  const [cfg, setCfg] = useState<D365Config>(EMPTY);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState<Run[]>([]);
  const [linked, setLinked] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { dirty, markSaved } = useSettingsDirty({ cfg, secrets });
  const [preview, setPreview] = useState<{ entity: D365EntityKey; rows: Record<string, unknown>[] } | null>(null);
  // The full redirect URI to register on the app: it needs this site's own
  // address, known only in the browser (so it is filled in after mount).
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const loadRuns = useCallback(() => {
    fetch("/api/connectors/dynamics365/runs").then((r) => r.json()).then((j) => { setRuns(j.runs ?? []); setLinked(j.linked ?? {}); }).catch(() => {});
  }, []);

  useEffect(() => {
    call("/api/connectors/dynamics365").then((s: D365PublicState) => { setState(s); if (s.config) { setCfg(s.config); markSaved({ cfg: s.config, secrets: {} }); } }).catch((e) => setFlash({ ok: false, text: e.message }));
    loadRuns();
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("d365_error")) setFlash({ ok: false, text: sp.get("d365_error")! });
    if (sp.get("d365_connected")) setFlash({ ok: true, text: "Signed in to Microsoft — connection works." });
    if (sp.toString()) window.history.replaceState(null, "", window.location.pathname);
  }, [loadRuns]);

  const modes = D365_AUTH_FOR_PRODUCT[cfg.product];
  const set = (p: Partial<D365Config>) => setCfg((x) => ({ ...x, ...p }));
  const ent = (k: D365EntityKey): D365EntityConfig | null => entityConfig(cfg, k);
  const setEnt = (k: D365EntityKey, p: Partial<D365EntityConfig>) => setCfg((x) => {
    const cur = entityConfig(x, k) ?? { enabled: false, entity_set: "", id_field: "id", field_map: {} };
    return { ...x, entities: { ...x.entities, [k]: { ...cur, ...p } } };
  });

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key);
    setFlash(null);
    try {
      const m = await fn();
      if (m) setFlash({ ok: true, text: m });
    } catch (e) {
      setFlash({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
      loadRuns();
    }
  };

  const save = () => run("save", async () => {
    const s: D365PublicState = await call("/api/connectors/dynamics365", json("PUT", { config: cfg, secrets }));
    setState(s);
    if (s.config) setCfg(s.config);
    setSecrets({});
    markSaved({ cfg: s.config ?? cfg, secrets: {} });
    return "Saved. Press Test connection to check it.";
  });

  const envLabel = cfg.product === "bc"
    ? (cfg.auth_mode === "basic" ? "API base URL (on-premises), e.g. https://bc.contoso.com:7048/BC/api/v2.0" : "Environment name, e.g. Production")
    : cfg.product === "fo" ? "Environment URL, e.g. https://contoso.operations.dynamics.com" : "Environment URL, e.g. https://contoso.crm4.dynamics.com";

  const stored = state?.secrets;
  const secretInput = (key: "client_secret" | "password", label: string) => (
    <div>
      <label style={lbl}>{label}{stored?.[key] ? " · stored" : ""}</label>
      <input type="password" autoComplete="new-password" style={inp} value={secrets[key] ?? ""} onChange={(e) => setSecrets({ ...secrets, [key]: e.target.value })} placeholder={stored?.[key] ? "Leave blank to keep the stored value" : ""} />
    </div>
  );
  const pemInput = (key: "certificate" | "private_key", label: string, ph: string) => (
    <div>
      <label style={lbl}>{label}{stored?.[key] ? " · stored" : ""}</label>
      <textarea rows={4} style={{ ...inp, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5, resize: "vertical" }} value={secrets[key] ?? ""} onChange={(e) => setSecrets({ ...secrets, [key]: e.target.value })} placeholder={stored?.[key] ? "Leave blank to keep the stored value" : ph} />
    </div>
  );

  const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" };
  const status = state?.status ?? "not_connected";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
      {flash && <div role={flash.ok ? "status" : "alert"} style={{ fontSize: 13, padding: "9px 12px", borderRadius: 8, color: flash.ok ? "var(--greenink)" : "var(--redink)", background: flash.ok ? "var(--greenbg)" : "var(--redbg)", whiteSpace: "pre-wrap" }}>{flash.text}</div>}

      <section style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className="bpm-t-section">Connection</div>
          <Pill label={status === "connected" ? "Connected" : status === "error" ? (state?.last_error ? "Needs attention" : "Not tested") : "Not connected"} tone={status === "connected" ? "green" : status === "error" ? "amber" : "purple"} />
        </div>
        {state?.last_error && status !== "connected" && <div style={{ fontSize: 12.5, color: "var(--amberink)" }}>{state.last_error}</div>}
        <div style={grid}>
          <div>
            <label style={lbl} htmlFor="prod">Product</label>
            <select id="prod" style={inp} value={cfg.product} onChange={(e) => {
              const product = e.target.value as D365Product;
              set({ product, auth_mode: D365_AUTH_FOR_PRODUCT[product].includes(cfg.auth_mode) ? cfg.auth_mode : "client_secret", entities: {} });
            }}>
              {D365_PRODUCTS.map((p) => <option key={p} value={p}>{D365_PRODUCT_LABEL[p]}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl} htmlFor="auth">Login type</label>
            <select id="auth" style={inp} value={cfg.auth_mode} onChange={(e) => set({ auth_mode: e.target.value as D365AuthMode })}>
              {modes.map((m) => <option key={m} value={m}>{D365_AUTH_LABEL[m]}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={lbl} htmlFor="env">{envLabel}</label>
            <input id="env" style={inp} value={cfg.environment_url} onChange={(e) => set({ environment_url: e.target.value })} />
          </div>
          {cfg.auth_mode !== "basic" && (
            <>
              <div><label style={lbl} htmlFor="dir">Entra ID directory (tenant) ID or domain</label><input id="dir" style={inp} value={cfg.directory_id ?? ""} onChange={(e) => set({ directory_id: e.target.value })} placeholder="00000000-0000-0000-0000-000000000000" /></div>
              <div><label style={lbl} htmlFor="cid">Application (client) ID</label><input id="cid" style={inp} value={cfg.client_id ?? ""} onChange={(e) => set({ client_id: e.target.value })} /></div>
            </>
          )}
          {(cfg.auth_mode === "client_secret" || cfg.auth_mode === "authorization_code") && secretInput("client_secret", "Client secret")}
          {cfg.auth_mode === "basic" && (
            <>
              <div><label style={lbl} htmlFor="user">Username</label><input id="user" style={inp} autoComplete="off" value={cfg.username ?? ""} onChange={(e) => set({ username: e.target.value })} /></div>
              {secretInput("password", "Password or web service access key")}
            </>
          )}
          {cfg.product !== "dataverse" && (
            <div>
              <label style={lbl} htmlFor="co">{cfg.product === "fo" ? "Legal entity (dataAreaId), e.g. USMF" : "Company id (GUID — Test connection lists them)"}</label>
              <input id="co" style={inp} value={cfg.company ?? ""} onChange={(e) => set({ company: e.target.value })} />
            </div>
          )}
          <div>
            <label style={lbl} htmlFor="sch">Automatic sync</label>
            <select id="sch" style={inp} value={cfg.schedule} onChange={(e) => set({ schedule: e.target.value as D365Config["schedule"] })}>
              <option value="off">Off — sync by hand</option>
              <option value="hourly">Every hour</option>
              <option value="daily">Daily (02:00 UTC)</option>
            </select>
          </div>
        </div>
        {cfg.auth_mode === "certificate" && (
          <div style={grid}>
            {pemInput("certificate", "Certificate (PEM)", "-----BEGIN CERTIFICATE-----")}
            {pemInput("private_key", "Private key (PEM, unencrypted)", "-----BEGIN PRIVATE KEY-----")}
          </div>
        )}
        <div className="bpm-t-help">
          {cfg.auth_mode === "basic"
            ? "Basic login is for Business Central on-premises only. Use an HTTPS address reachable from the internet."
            : <>In Microsoft Entra ID, register an app, add {cfg.auth_mode === "certificate" ? "the certificate" : "a client secret"}, and {cfg.product === "bc" ? "grant it the Business Central API permission (API.ReadWrite.All) and add it under Microsoft Entra applications in Business Central." : cfg.product === "fo" ? "add its client ID under System administration → Microsoft Entra applications in Finance & Operations." : "add it as an application user with a security role in the Power Platform admin center."} Secrets are encrypted and never shown again.</>}
        </div>
        {cfg.auth_mode === "authorization_code" && (
          <div className="bpm-t-help" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div>Redirect URI to add to the app registration (platform: Web):</div>
            <code style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, wordBreak: "break-all", userSelect: "all" }}>{origin}/api/connectors/dynamics365/oauth/callback</code>
            <div>
              Under API permissions add the <strong>delegated</strong> permission (not Application), then grant admin consent: {cfg.product === "dataverse"
                ? "Dynamics CRM → user_impersonation."
                : cfg.product === "fo"
                  ? "Dynamics ERP → Odata.FullAccess (and AX.FullAccess)."
                  : "Dynamics 365 Business Central → Financials.ReadWrite.All."} The person who presses Connect with Microsoft also needs access inside Dynamics, because syncs run as them.
            </div>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <SettingsSave dirty={dirty} saving={busy === "save"} onSave={save} />
          <button type="button" style={btnGhost} disabled={!!busy || !state?.config} onClick={() => run("test", async () => (await call("/api/connectors/dynamics365/test", { method: "POST" })).message)}>{busy === "test" ? "Testing…" : "Test connection"}</button>
          {cfg.auth_mode === "authorization_code" && state?.config && <a href="/api/connectors/dynamics365/oauth/start" style={{ ...btnGhost, textDecoration: "none", display: "inline-block" }}>{state.secrets.refresh_token ? "Sign in again with Microsoft" : "Connect with Microsoft"}</a>}
          {state?.config && <button type="button" style={{ ...btnGhost, color: "var(--redink)" }} disabled={!!busy} onClick={() => run("del", async () => {
            if (!confirm("Disconnect Dynamics 365? Records already synced stay in BPMSquare.")) return;
            await call("/api/connectors/dynamics365", { method: "DELETE" });
            setState(null); setCfg(EMPTY);
            return "Disconnected.";
          })}>Disconnect</button>}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="bpm-t-section">What syncs</div>
        <div className="bpm-t-help">Defaults are Microsoft&apos;s standard entities. A customised environment may name things differently — press Preview to see the real field names, adjust the map, Save, then Sync. Pulls create new records and update the mapped fields of records they created before; they never delete anything or touch fields outside the map.</div>
        {D365_ENTITY_KEYS.map((k) => (
          <EntityCard key={k} k={k} e={ent(k)} linked={linked[k] ?? 0} busy={busy} connected={!!state?.config}
            onChange={(p) => setEnt(k, p)}
            onPreview={() => run(`prev-${k}`, async () => { const j = await call("/api/connectors/dynamics365/preview", json("POST", { entity: k })); setPreview({ entity: k, rows: j.rows }); return j.rows.length ? undefined : "Preview returned no rows."; })}
            onSync={(full) => run(`sync-${k}`, async () => {
              const j = await call("/api/connectors/dynamics365/sync", json("POST", { entity: k, full }));
              const ct = j.counts as Record<string, number>;
              return `${D365_ENTITY_LABEL[k]}: ${ct.read} read · ${ct.created} created · ${ct.updated} updated · ${ct.unchanged} unchanged · ${ct.skipped} skipped · ${ct.failed} failed${j.issues?.length ? `\n${j.issues.slice(0, 5).join("\n")}` : ""}`;
            })}
          />
        ))}
      </section>

      {preview && (
        <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", borderBottom: `1px solid ${c.line}` }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: c.ink }}>Preview · {D365_ENTITY_LABEL[preview.entity]}</span>
            <button type="button" style={{ ...btnGhost, padding: "3px 9px" }} onClick={() => setPreview(null)}>Close</button>
          </div>
          <PreviewTable rows={preview.rows} />
        </section>
      )}

      <section style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", fontSize: 13, fontWeight: 700, color: c.ink, borderBottom: `1px solid ${c.line}` }}>Recent runs</div>
        {runs.length === 0 ? <div style={{ padding: 14, fontSize: 12.5, color: c.hint }}>No runs yet.</div> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead><tr>{["When", "What", "Result", "Read", "New", "Updated", "Unchanged", "Skipped", "Failed"].map((h) => <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: c.hint, background: c.panel2, fontWeight: 600 }}>{h}</th>)}</tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${c.line}`, verticalAlign: "top" }}>
                    <td style={{ padding: "8px 12px", whiteSpace: "nowrap", color: c.muted }}>{fmtDateTime(r.started_at)}{r.trigger === "schedule" ? " · auto" : ""}</td>
                    <td style={{ padding: "8px 12px", color: c.ink }}>{D365_ENTITY_LABEL[r.entity as D365EntityKey] ?? r.entity}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <Pill label={r.status} tone={r.status === "succeeded" ? "green" : r.status === "partial" ? "amber" : r.status === "failed" ? "red" : "blue"} />
                      {r.error && <div style={{ color: "var(--redink)", marginTop: 4, maxWidth: 360 }}>{r.error}</div>}
                      {r.issues?.length > 0 && <details style={{ marginTop: 4 }}><summary style={{ cursor: "pointer", color: c.muted }}>{r.issues.length} note{r.issues.length === 1 ? "" : "s"}</summary><ul style={{ margin: "4px 0 0 16px", padding: 0, color: c.muted }}>{r.issues.map((x, i) => <li key={i}>{x}</li>)}</ul></details>}
                    </td>
                    {["read", "created", "updated", "unchanged", "skipped", "failed"].map((k) => <td key={k} style={{ padding: "8px 12px", fontVariantNumeric: "tabular-nums", color: c.muted }}>{r.counts?.[k] ?? 0}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function EntityCard({ k, e, linked, busy, connected, onChange, onPreview, onSync }: {
  k: D365EntityKey; e: D365EntityConfig | null; linked: number; busy: string | null; connected: boolean;
  onChange: (p: Partial<D365EntityConfig>) => void; onPreview: () => void; onSync: (full: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mapText, setMapText] = useState(mapToText(e?.field_map ?? {}));
  useEffect(() => { setMapText(mapToText(e?.field_map ?? {})); }, [e?.entity_set]); // product switch resets the defaults
  const push = D365_ENTITY_TARGET[k].direction === "push";
  const small: React.CSSProperties = { ...inp, fontSize: 12 };
  const hint = useMemo(() => push
    ? "One line per Dynamics field: Field = template. Templates use {name} {ref} {summary} {total_length_m} {status} {account_external_id}. A line whose value comes out empty isn't sent."
    : "One line per BPMSquare field: field = DynamicsField. Fields: name, city, phone, email (customers, vendors) · name, email, phone, role (contacts) · name, sku, uom, list_price, description (products) · name, code (projects). account_external_id = the field holding the customer's id links contacts/projects to synced customers.", [push]);
  if (!e) return null;
  return (
    <div style={{ ...cardStyle, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label className="bpm-t-label" style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", flex: 1, minWidth: 220 }}>
          <input type="checkbox" checked={e.enabled} onChange={(ev) => onChange({ enabled: ev.target.checked })} />
          {D365_ENTITY_LABEL[k]}
          <span className="bpm-t-help">{e.entity_set || "—"}{linked ? ` · ${linked} linked` : ""}</span>
        </label>
        <button type="button" style={{ ...btnGhost, padding: "4px 10px", fontSize: 12 }} onClick={() => setOpen((o) => !o)}>{open ? "Hide map" : "Map"}</button>
        {!push && <button type="button" style={{ ...btnGhost, padding: "4px 10px", fontSize: 12 }} disabled={!connected || !!busy} onClick={onPreview}>{busy === `prev-${k}` ? "Loading…" : "Preview"}</button>}
        <button type="button" style={{ ...btnPrimary, padding: "5px 12px", fontSize: 12 }} disabled={!connected || !e.enabled || !!busy} onClick={() => onSync(false)}>{busy === `sync-${k}` ? "Working…" : push ? "Push won projects" : "Sync now"}</button>
        {!push && <button type="button" title={e.modified_field ? undefined : "This entity has no modified-on field, so each run reads on from where the last one stopped and starts over after the last row. This starts over now."} style={{ ...btnGhost, padding: "4px 10px", fontSize: 12 }} disabled={!connected || !e.enabled || !!busy} onClick={() => onSync(true)}>{e.modified_field ? "Full resync" : "Start over"}</button>}
      </div>
      {open && (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", marginTop: 12 }}>
          <div><label style={lbl}>Entity set</label><input style={small} value={e.entity_set} onChange={(ev) => onChange({ entity_set: ev.target.value })} /></div>
          <div><label style={lbl}>Id field</label><input style={small} value={e.id_field} onChange={(ev) => onChange({ id_field: ev.target.value })} /></div>
          {!push && <div><label style={lbl}>Number / key field</label><input style={small} value={e.key_field ?? ""} onChange={(ev) => onChange({ key_field: ev.target.value || undefined })} /></div>}
          {!push && <div><label style={lbl}>Modified-on field (incremental)</label><input style={small} value={e.modified_field ?? ""} onChange={(ev) => onChange({ modified_field: ev.target.value || undefined })} /></div>}
          {!push && <div style={{ gridColumn: "1 / -1" }}><label style={lbl}>OData filter (optional)</label><input style={small} value={e.filter ?? ""} onChange={(ev) => onChange({ filter: ev.target.value || undefined })} placeholder="e.g. statecode eq 0" /></div>}
          <div style={{ gridColumn: "1 / -1" }}>
            <label style={lbl}>Field map</label>
            <textarea rows={5} style={{ ...small, fontFamily: "ui-monospace, Menlo, monospace", resize: "vertical" }} value={mapText}
              onChange={(ev) => setMapText(ev.target.value)} onBlur={() => onChange({ field_map: textToMap(mapText) })} />
            <div className="bpm-t-help" style={{ marginTop: 4 }}>{hint} Save the connection to keep changes.</div>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 40);
  if (!rows.length) return <div style={{ padding: 14, fontSize: 12.5, color: c.hint }}>No rows.</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 11.5 }}>
        <thead><tr>{cols.map((k) => <th key={k} style={{ textAlign: "left", padding: "6px 10px", background: c.panel2, color: c.hint, whiteSpace: "nowrap", fontFamily: "ui-monospace, Menlo, monospace" }}>{k}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: `1px solid ${c.line}` }}>{cols.map((k) => <td key={k} style={{ padding: "6px 10px", color: c.ink, whiteSpace: "nowrap", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{r[k] === null || r[k] === undefined ? "" : typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
