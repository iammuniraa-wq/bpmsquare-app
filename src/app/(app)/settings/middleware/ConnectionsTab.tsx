"use client";

import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import StatusPill from "@/components/ui/StatusPill";
import { ROUTES } from "@/lib/constants";
import s from "./middleware.module.css";
import { checkPermissions, getCurrencies, getPriceLists, saveConnection, type PermissionCheck, type PickList } from "./api";
import { useMw } from "./context";
import { needsPickLists } from "./connectors";
import { MIDDLEWARE_TIPS, secretExpiryTip } from "./tips";
import { CheckIcon, Notice, ProblemNotice, describeError, useFlash, useLoad } from "./ui";
import ConnectionForm from "./ConnectionForm";

/** Coming back from the Microsoft sign-in leaves the result in the address; read it once, then tidy the address. */
function useAuthReturn(): { ok: boolean; text: string } | null {
  const [r, setR] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const bad = sp.get("d365_error");
    const good = sp.get("d365_connected");
    if (!bad && !good) return;
    setR(bad ? { ok: false, text: bad } : { ok: true, text: "Signed in. The connection works." });
    sp.delete("d365_error"); sp.delete("d365_connected");
    const q = sp.toString();
    window.history.replaceState(null, "", window.location.pathname + (q ? `?${q}` : ""));
  }, []);
  return r;
}

export default function ConnectionsTab() {
  const mw = useMw();
  const authReturn = useAuthReturn();
  const { health, connection, connector } = mw;
  const h = health.data;
  const connected = h?.connection.connected === true;
  const productKey = h?.connection.product?.key ?? connection?.state.config?.product ?? null;
  const missing = h?.schema.filter((r) => !r.exists) ?? [];

  return (
    <>
      {health.error != null && <ProblemNotice error={health.error} onRetry={() => void health.reload()} />}
      {h && h.needsDatabaseUpdate && (
        <Notice tone="warn">
          <span className={s.noticeStrong}>A database update is needed.</span>{" "}
          {missing.map((m) => m.label).join(", ")} {missing.length === 1 ? "is" : "are"} missing. Run {[...new Set(missing.map((m) => m.bundle).filter(Boolean))].join(" and ")} once, then reload.
        </Notice>
      )}
      {h && h.secret.state === "soon" && <Notice tone="warn"><span className={s.noticeStrong}>The secret ends soon.</span> {secretExpiryTip(h.secret.days_left)}</Notice>}
      {h && h.secret.state === "expired" && <Notice tone="err"><span className={s.noticeStrong}>The secret has ended.</span> {secretExpiryTip(h.secret.days_left)}</Notice>}

      <Card
        title={connector.name}
        info={MIDDLEWARE_TIPS.connection}
        action={<StatusPill label={connected ? "Connected" : h?.connection.state === "error" ? "Needs attention" : "Not connected"} tone={connected ? "green" : h?.connection.state === "error" ? "amber" : "purple"} />}
      >
        {mw.connections.error != null && !connection
          ? <ProblemNotice error={mw.connections.error} onRetry={() => void mw.connections.reload()} />
          : <ConnectionForm item={connection} connectorId={connector.id} onChanged={mw.reloadAll} authReturn={authReturn} />}
      </Card>

      <div className={s.cols2}>
        {needsPickLists(productKey) && connected && <PickListsCard connectorId={connector.id} />}
        {connected && <PermissionsCard />}
        <SchemaCard />
        <LanesCard />
      </div>
    </>
  );
}

// ── Price list and currency, read live ──────────────────────────────────────

function PickListsCard({ connectorId }: { connectorId: string }) {
  const mw = useMw();
  const lists = useLoad(async () => ({ price: await getPriceLists(), cur: await getCurrencies() }), [connectorId]);
  const cfg = mw.connection?.state.config ?? null;
  const [busy, setBusy] = useState(false);
  const { flash, show } = useFlash();

  const choose = async (patch: { price_list_id?: string; currency_id?: string }) => {
    if (!cfg) return;
    setBusy(true);
    try {
      await saveConnection(connectorId, { ...cfg, ...patch });
      show(true, "Saved.");
      await mw.reloadAll();
    } catch (e) {
      show(false, describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const select = (label: string, info: string, id: string, value: string | undefined, list: PickList | undefined, onPick: (v: string) => void) => {
    const items = list?.items ?? [];
    const gone = !!value && !items.some((i) => i.id === value);
    return (
      <Field label={label} info={info} htmlFor={id} style={{ marginBottom: 0 }}>
        <select id={id} className="bpm-input" value={value ?? ""} disabled={busy || !list} onChange={(e) => e.target.value && onPick(e.target.value)}>
          <option value="">{list ? "Choose…" : "Loading…"}</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.name} (${i.code})` : i.name}</option>)}
          {gone && <option value={value}>Saved choice (not in the list now)</option>}
        </select>
      </Field>
    );
  };

  return (
    <Card title="Price list and currency">
      <div className={s.stack}>
        {lists.error != null && <ProblemNotice error={lists.error} onRetry={() => void lists.reload()} />}
        {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
        {select("Price list", MIDDLEWARE_TIPS.priceList, "mw-pl", cfg?.price_list_id, lists.data?.price, (v) => void choose({ price_list_id: v }))}
        {select("Currency", MIDDLEWARE_TIPS.currency, "mw-cur", cfg?.currency_id, lists.data?.cur, (v) => void choose({ currency_id: v }))}
        {lists.data && lists.data.price.items.length === 0 && <Notice tone="warn">No active price list was found in the ERP. Create one there, then reload.</Notice>}
      </div>
    </Card>
  );
}

// ── Check permissions ───────────────────────────────────────────────────────

function PermissionsCard() {
  const [checks, setChecks] = useState<PermissionCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { setChecks((await checkPermissions()).checks); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card title="Permissions" info={MIDDLEWARE_TIPS.permissions} action={<Button size="sm" onClick={run} loading={busy}>Check permissions</Button>}>
      {error != null && <ProblemNotice error={error} />}
      {!checks && error == null && <div className={`${s.small} ${s.muted}`}>Not checked yet.</div>}
      {checks && (
        <ul className={s.words} style={{ listStyle: "none" }}>
          {checks.map((c) => (
            <li key={c.id} style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <StatusPill label={c.ok === true ? "Allowed" : c.ok === false ? "Missing" : "Unknown"} tone={c.ok === true ? "green" : c.ok === false ? "red" : "amber"} />
              <span>{c.label}</span>
              {c.fix && <span className={`${s.small} ${s.muted}`}>{c.fix}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Schema health ───────────────────────────────────────────────────────────

function SchemaCard() {
  const { health } = useMw();
  const rows = health.data?.schema ?? [];
  return (
    <Card title="Database" info={MIDDLEWARE_TIPS.schema}>
      {rows.length === 0 ? (
        <div className={`${s.small} ${s.muted}`}>{health.loading ? "Checking…" : "Not checked yet."}</div>
      ) : (
        <ul className={s.words} style={{ listStyle: "none" }}>
          {rows.map((r) => (
            <li key={r.table} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span aria-hidden="true" style={{ color: r.exists ? "var(--greenink)" : "var(--redink)", display: "inline-flex" }}>{r.exists ? <CheckIcon /> : "✕"}</span>
              <span>{r.label}</span>
              <span className="bpm-sr-only">{r.exists ? "present" : "missing"}</span>
              {!r.exists && r.bundle && <span className={`${s.mono} ${s.muted} ${s.wrapAny}`}>{r.bundle}</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── Other lanes ─────────────────────────────────────────────────────────────

function LanesCard() {
  return (
    <Card title="Other lanes" info={MIDDLEWARE_TIPS.otherLanes}>
      <div className={s.stack} style={{ gap: 8 }}>
        <div className={`${s.row} bpm-tap`}>
          <Button href={ROUTES.settingsPush}>Webhooks and push</Button>
          <Button href={ROUTES.settingsDeveloper}>API keys</Button>
          <Button href={ROUTES.dataWorkbench}>Data Workbench</Button>
        </div>
      </div>
    </Card>
  );
}
