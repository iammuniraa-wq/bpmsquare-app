"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { useFeel } from "@/components/FeelProvider";
import s from "./middleware.module.css";
import { disconnect, saveRules, testConnection } from "./api";
import { useMw } from "./context";
import { addressLine, testOutcome, type TestOutcome } from "./connectionLogic";
import { SAP_S4 } from "./connectors";
import { MIDDLEWARE_TIPS } from "./tips";
import { Notice, Switch, describeError, useFlash } from "./ui";
import ConnectionForm from "./ConnectionForm";
import SapConnectionForm from "./SapConnectionForm";
import Panel from "./Panel";

/** Coming back from the Microsoft sign-in leaves the result in the address; read it once, then tidy the address. */
export function useAuthReturn(): { ok: boolean; text: string } | null {
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

/**
 * The connection, behind the connector chip: one line (state, address, Test, Edit, Disconnect), Test's
 * ONE result line, and Edit for the sign-in fields. A workspace with no connection sees the form to make one.
 */
export default function ConnectionPanel({ authReturn, onClose }: { authReturn: { ok: boolean; text: string } | null; onClose: () => void }) {
  const mw = useMw();
  const { confirm } = useFeel();
  const { connector, connection, health } = mw;
  const stored = connection?.state.config ?? null;
  const connected = health.data?.connection.connected === true || connection?.state.status === "connected";
  const Form = connector.id === SAP_S4 ? SapConnectionForm : ConnectionForm;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"test" | "disconnect" | null>(null);
  const [outcome, setOutcome] = useState<TestOutcome | null>(null);
  const [details, setDetails] = useState(false);
  const { flash, show } = useFlash();
  useEffect(() => { if (authReturn) show(authReturn.ok, authReturn.text); }, [authReturn, show]);

  const test = async () => {
    setBusy("test"); setOutcome(null); setDetails(false);
    try { setOutcome(testOutcome(await testConnection(connector.id))); } catch (e) { setOutcome({ ok: false, line: "Could not test the connection.", failures: [{ label: describeError(e), fix: null }] }); }
    setBusy(null);
    await mw.reloadAll();
  };

  const remove = async () => {
    if (!(await confirm({ title: "Disconnect?", body: "Records already synced stay in BPMSquare. Nothing new goes out until you connect again.", confirmLabel: "Disconnect", tone: "danger" }))) return;
    setBusy("disconnect");
    try { await disconnect(connector.id); setOutcome(null); show(true, "Disconnected."); } catch (e) { show(false, describeError(e)); } finally { setBusy(null); await mw.reloadAll(); }
  };

  return (
    <Panel title={connector.name} onClose={onClose} label="Connection">
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}

      {!stored ? (
        <>
          <h3 className="bpm-t-label">Connect {connector.shortName}</h3>
          <Form item={connection} connectorId={connector.id} onChanged={mw.reloadAll} />
        </>
      ) : (
        <>
          <div className={s.connLine}>
            <span className={s.connText}>
              <span className={`${s.dot} ${connected ? s.dotOn : s.dotWarn}`} aria-hidden="true" />
              {connected ? "Connected" : connection?.state.status === "error" ? "Needs attention" : "Not connected"}
              {addressLine(connector.id, stored) ? <> · <span className={s.wrapAny}>{addressLine(connector.id, stored)}</span></> : null}
            </span>
            <span className={`${s.row} bpm-tap`}>
              <Button size="sm" data-guide="middleware.test" onClick={() => void test()} loading={busy === "test"} disabled={!!busy}>Test</Button>
              <Button size="sm" data-guide="middleware.edit" aria-pressed={editing} onClick={() => setEditing((e) => !e)} disabled={!!busy}>Edit</Button>
              <Button size="sm" variant="danger" onClick={() => void remove()} loading={busy === "disconnect"} disabled={!!busy}>Disconnect</Button>
            </span>
          </div>

          {outcome && (
            <Notice
              tone={outcome.ok ? "ok" : "err"}
              action={outcome.failures.length > 0 ? <Button size="sm" aria-expanded={details} onClick={() => setDetails((d) => !d)}>{details ? "Hide details" : "Show details"}</Button> : undefined}
            >
              {outcome.line}
            </Notice>
          )}
          {outcome && details && (
            <ul className={s.words}>
              {outcome.failures.map((f, i) => <li key={i}>{f.label}{f.fix ? <span className={s.muted}> {f.fix}</span> : null}</li>)}
            </ul>
          )}

          {editing && <Form item={connection} connectorId={connector.id} onChanged={mw.reloadAll} onSaved={() => setEditing(false)} />}
          <CaptureRow />
        </>
      )}
    </Panel>
  );
}

/** Keep the bodies of inbound pulls and API calls for 2 days. A setting of the connection, so it lives here. */
function CaptureRow() {
  const mw = useMw();
  const r = mw.rules.data;
  const { flash, show } = useFlash();
  if (!r) return null;
  const toggle = async (v: boolean) => {
    try { mw.rules.setData(await saveRules({ payload_capture: v })); show(true, v ? "Kept for 2 days." : "No longer kept."); } catch (e) { show(false, describeError(e)); }
  };
  return (
    <div className={s.rowBetween}>
      <span className="bpm-label-row"><span className="bpm-t-label">Keep bodies of inbound pulls and API calls</span><InfoTip label="Keep bodies">{MIDDLEWARE_TIPS.capture}</InfoTip></span>
      <span className={s.row}>
        {flash && <span className={`${s.small} ${s.muted}`} role="status">{flash.text}</span>}
        <Switch checked={r.payload_capture} label={`Keep bodies of inbound pulls and API calls: ${r.payload_capture ? "on" : "off"}`} onChange={(v) => void toggle(v)} />
      </span>
    </div>
  );
}
