"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import s from "./middleware.module.css";
import { ApiProblem } from "./api";

// Small pieces the five tabs share. Icons are SVG only.

export function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
  );
}
export function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  );
}
export function ExternalIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
  );
}
export function ArrowIcon({ dir }: { dir: "in" | "out" }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      {dir === "out" ? <path d="M6 18L18 6M9 6h9v9" /> : <path d="M18 6L6 18M15 18H6V9" />}
    </svg>
  );
}

/** A message that must stay on screen: an error, a blocker, a warning, or a result. */
export function Notice({ tone, children, action, live }: { tone: "info" | "ok" | "warn" | "err"; children: React.ReactNode; action?: React.ReactNode; live?: boolean }) {
  const cls = { info: s.noticeInfo, ok: s.noticeOk, warn: s.noticeWarn, err: s.noticeErr }[tone];
  return (
    <div className={`${s.notice} ${cls}`} role={tone === "err" ? "alert" : live === false ? undefined : "status"}>
      <div className={s.noticeBody}>{children}</div>
      {action}
    </div>
  );
}

/** What went wrong, as the person reads it. A route that is not installed yet is information, not an error. */
export function describeError(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}

export function ProblemNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const installing = error instanceof ApiProblem && error.installing;
  return (
    <Notice tone={installing ? "info" : "err"} action={onRetry ? <Button size="sm" onClick={onRetry}>Try again</Button> : undefined}>
      {describeError(error)}
      {error instanceof ApiProblem && error.fix ? <> {error.fix}</> : null}
    </Notice>
  );
}

/** Load once (and on `reload`), keeping the last good answer while a reload runs. */
export function useLoad<T>(fn: () => Promise<T>, deps: readonly unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const ref = useRef(fn);
  ref.current = fn;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const d = await ref.current();
      if (mine === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (mine === seq.current) setError(e);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, deps);
  return { data, setData, error, loading, reload };
}

/** An on/off switch. The tap area is 44px; the label is the accessible name. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <span className={s.switchTap}>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={s.switch} disabled={disabled} onClick={() => onChange(!checked)} />
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, disabled }: {
  value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean;
}) {
  return (
    <div className={s.seg} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} disabled={disabled} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/** The one saved/failed line a tab shows after an action; clears itself after a while when it is good news. */
export function useFlash() {
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((ok: boolean, text: string) => {
    if (timer.current) clearTimeout(timer.current);
    setFlash({ ok, text });
    if (ok) timer.current = setTimeout(() => setFlash(null), 4000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { flash, show, clear: () => setFlash(null) };
}
