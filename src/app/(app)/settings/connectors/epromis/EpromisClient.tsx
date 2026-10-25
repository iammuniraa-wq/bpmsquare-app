"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { useFeel } from "@/components/FeelProvider";
import type { EpromisPublicState } from "@/lib/connectors/epromis/types";
import s from "../../middleware/middleware.module.css";
import { Notice } from "../../middleware/ui";
import EpromisForm from "./EpromisForm";
import { formFromState, formProblem, hostOf, mapSummary, saveBody, type EpromisForm as Form } from "./epromisLogic";

type TestAnswer = { ok: boolean; line: string; failures?: { label: string; fix: string | null }[]; error?: string };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok && !("line" in (json as object))) throw new Error(json.error ?? "Something went wrong. Try again.");
  return json;
}

/** The ePROMIS connection: one line (state, address, Test, Edit, Disconnect) or, with none, the form to make one. */
export default function EpromisClient() {
  const { confirm } = useFeel();
  const [state, setState] = useState<EpromisPublicState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(formFromState(null));
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<"test" | "disconnect" | null>(null);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [test, setTest] = useState<TestAnswer | null>(null);

  const load = useCallback(async () => {
    try {
      const st = await call<EpromisPublicState>("/api/connectors/epromis");
      setState(st);
      setForm(formFromState(st));
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loadError) return <Notice tone="err">{loadError}</Notice>;
  if (!state) return <div className="bpm-t-help">Loading…</div>;

  const stored = state.config;
  const problem = formProblem(form, secret, state.secret_stored);

  const save = async () => {
    setSaving(true);
    setFlash(null);
    try {
      const st = await call<EpromisPublicState>("/api/connectors/epromis", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saveBody(form, secret)) });
      setState(st);
      setForm(formFromState(st));
      setSecret("");
      setEditing(false);
      setTest(null);
      setFlash({ ok: true, text: "Saved. Press Test to check the connection." });
    } catch (e) {
      setFlash({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setBusy("test");
    setTest(null);
    try {
      setTest(await call<TestAnswer>("/api/connectors/epromis/test", { method: "POST" }));
    } catch (e) {
      setTest({ ok: false, line: (e as Error).message });
    }
    setBusy(null);
    await load();
  };

  const remove = async () => {
    if (!(await confirm({ title: "Disconnect ePROMIS?", body: "Nothing is read from or sent to ePROMIS until you connect again.", confirmLabel: "Disconnect", tone: "danger" }))) return;
    setBusy("disconnect");
    try {
      await call("/api/connectors/epromis", { method: "DELETE" });
      setTest(null);
      setFlash({ ok: true, text: "Disconnected." });
      await load();
    } catch (e) {
      setFlash({ ok: false, text: (e as Error).message });
    }
    setBusy(null);
  };

  const connected = state.status === "connected";
  return (
    <div className={s.stack} style={{ maxWidth: 640 }}>
      {flash && <Notice tone={flash.ok ? "ok" : "err"}>{flash.text}</Notice>}
      {!stored ? (
        <EpromisForm form={form} setForm={setForm} secret={secret} setSecret={setSecret} secretStored={false} problem={problem} saving={saving} onSave={() => void save()} fresh />
      ) : (
        <>
          <div className={s.connLine}>
            <span className={s.connText}>
              <span className={`${s.dot} ${connected ? s.dotOn : s.dotWarn}`} aria-hidden="true" />
              {connected ? "Connected" : "Needs attention"} · <span className={s.wrapAny}>{hostOf(stored.base_url)}</span>
            </span>
            <span className={`${s.row} bpm-tap`}>
              <Button size="sm" onClick={() => void runTest()} loading={busy === "test"} disabled={!!busy}>Test</Button>
              <Button size="sm" aria-pressed={editing} onClick={() => setEditing((e) => !e)} disabled={!!busy}>Edit</Button>
              <Button size="sm" variant="danger" onClick={() => void remove()} loading={busy === "disconnect"} disabled={!!busy}>Disconnect</Button>
            </span>
          </div>
          <div className="bpm-t-help">{mapSummary(stored)}</div>
          {!connected && state.last_error && !test && <Notice tone="warn">{state.last_error}</Notice>}
          {test && (
            <Notice tone={test.ok ? "ok" : "err"}>{test.line}</Notice>
          )}
          {editing && (
            <EpromisForm form={form} setForm={setForm} secret={secret} setSecret={setSecret} secretStored={state.secret_stored} problem={problem} saving={saving} onSave={() => void save()} fresh={false} />
          )}
        </>
      )}
    </div>
  );
}
