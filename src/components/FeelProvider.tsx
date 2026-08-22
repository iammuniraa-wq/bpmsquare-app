"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useIsNextgen3Layer } from "@/lib/tenant-context";

/**
 * Nova pillar 5 — the feel layer, part one: confirmations and toasts.
 *
 * The app asked for destructive confirmation with window.confirm in 26
 * places and reported failure with alert(). Both are OS chrome: they
 * freeze the page, can't say which record they mean beyond a string, and
 * look identical in every product ever made. This replaces them with a
 * real dialog and a real toast stack.
 *
 * Gated the same way as everything else in Nova, but with an important
 * difference in HOW: a tenant without the flag doesn't lose the
 * confirmation, it just gets the browser one back. Every call site is
 * written once, against `useFeel()`, and behaves correctly on both sides
 * of the flag -- so migrating a call site is never a behaviour change for
 * an existing client (bpmsquarecore §10 rule 1).
 *
 * Toasts carrying `undo` do NOT resurrect anything after the fact -- the
 * caller defers the destructive work and the toast cancels it before it
 * ever runs. An undo that can't actually undo is worse than no undo.
 */

type Tone = "success" | "error" | "info";

export type ConfirmOptions = {
  title: string;
  /** One sentence on what will actually happen. Shown under the title. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" paints the confirm button red; use for anything destructive. */
  tone?: "danger" | "default";
};

export type ToastOptions = {
  text: string;
  tone?: Tone;
  /** Rendered as an Undo button; the toast dismisses once it resolves. */
  undo?: () => void | Promise<void>;
  /** Milliseconds on screen. Undo toasts default to longer. */
  duration?: number;
};

type FeelApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (options: ToastOptions) => void;
  /** The deferred-destructive pattern the docblock describes, packaged:
   *  `action` runs after `duration` ms unless the toast's Undo cancels it.
   *  Off-flag it runs immediately (the old chrome had no undo, and §10
   *  rule 1 forbids behaviour changes for tenants without Nova). Pending
   *  actions flush on pagehide so leaving the app can't lose a delete. */
  undoable: (options: { text: string; action: () => void | Promise<void>; duration?: number }) => void;
};

const FeelContext = createContext<FeelApi | null>(null);

/**
 * Safe to call from any client component. Outside a provider (the print
 * and public routes have no app shell) it degrades to the browser's own
 * dialogs rather than throwing.
 */
export function useFeel(): FeelApi {
  const ctx = useContext(FeelContext);
  const fallback = useRef<FeelApi>({
    confirm: async (o) => window.confirm(o.body ? `${o.title}\n\n${o.body}` : o.title),
    toast: (o) => { if (o.tone === "error") window.alert(o.text); },
    undoable: (o) => { void o.action(); },
  });
  return ctx ?? fallback.current;
}

type ToastItem = ToastOptions & { id: number };
type PendingConfirm = ConfirmOptions & { resolve: (ok: boolean) => void };

export default function FeelProvider({ children }: { children: React.ReactNode }) {
  const nova = useIsNextgen3Layer();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    if (!nova) {
      // Errors still have to reach the user on the old chrome; successes
      // were never announced there, so announcing them now would be a
      // visible change for a tenant that didn't ask for one.
      if (options.tone === "error") window.alert(options.text);
      return;
    }
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-3), { ...options, id }]);
  }, [nova]);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    if (!nova) {
      return Promise.resolve(window.confirm(options.body ? `${options.title}\n\n${options.body}` : options.title));
    }
    return new Promise<boolean>((resolve) => setPending({ ...options, resolve }));
  }, [nova]);

  // Deferred destructive actions (undo toasts). Held provider-level so an
  // in-app navigation never cancels a pending delete -- only Undo does.
  const pendingActions = useRef(new Set<{ run: () => void }>());
  useEffect(() => {
    const flush = () => {
      pendingActions.current.forEach((p) => p.run());
      pendingActions.current.clear();
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const undoable = useCallback(({ text, action, duration = 6000 }: { text: string; action: () => void | Promise<void>; duration?: number }) => {
    if (!nova) { void action(); return; }
    let done = false;
    const entry = {
      run: () => { if (!done) { done = true; void action(); } },
    };
    pendingActions.current.add(entry);
    const timer = setTimeout(() => { entry.run(); pendingActions.current.delete(entry); }, duration);
    toast({
      text,
      tone: "info",
      duration,
      undo: () => { done = true; clearTimeout(timer); pendingActions.current.delete(entry); },
    });
  }, [nova, toast]);

  const api = useRef<FeelApi>({ confirm, toast, undoable });
  api.current = { confirm, toast, undoable };

  return (
    <FeelContext.Provider value={api.current}>
      {children}
      {nova && (
        <>
          <ToastStack toasts={toasts} onDismiss={dismiss} />
          {pending && (
            <ConfirmDialog
              options={pending}
              onResolve={(ok) => { pending.resolve(ok); setPending(null); }}
            />
          )}
        </>
      )}
    </FeelContext.Provider>
  );
}

function ConfirmDialog({ options, onResolve }: { options: ConfirmOptions; onResolve: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve(false);
      if (e.key === "Enter") onResolve(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onResolve]);

  const danger = options.tone === "danger";

  return (
    <div className="feel" role="dialog" aria-modal="true" aria-label={options.title}>
      <style>{CSS}</style>
      <div className="feel__scrim" onClick={() => onResolve(false)} />
      <div className="feel__dialog">
        <h2 className="feel__dialogTitle">{options.title}</h2>
        {options.body && <p className="feel__dialogBody">{options.body}</p>}
        <div className="feel__dialogActions">
          <button className="feel__btn" onClick={() => onResolve(false)}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            className={`feel__btn feel__btn--primary ${danger ? "feel__btn--danger" : ""}`}
            onClick={() => onResolve(true)}
          >
            {options.confirmLabel ?? (danger ? "Delete" : "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="feel__toasts" role="status" aria-live="polite">
      <style>{CSS}</style>
      {toasts.map((t) => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const duration = toast.duration ?? (toast.undo ? 7000 : 3800);

  const close = useCallback(() => {
    setLeaving(true);
    window.setTimeout(() => onDismiss(toast.id), 180);
  }, [onDismiss, toast.id]);

  useEffect(() => {
    const t = window.setTimeout(close, duration);
    return () => window.clearTimeout(t);
  }, [close, duration]);

  async function undo() {
    if (!toast.undo || busy) return;
    setBusy(true);
    try { await toast.undo(); } finally { close(); }
  }

  return (
    <div className={`feel__toast feel__toast--${toast.tone ?? "info"} ${leaving ? "is-leaving" : ""}`}>
      <span className="feel__toastDot" aria-hidden="true" />
      <span className="feel__toastText">{toast.text}</span>
      {toast.undo && (
        <button className="feel__undo" onClick={undo} disabled={busy}>
          {busy ? "Undoing…" : "Undo"}
        </button>
      )}
      <button className="feel__toastClose" onClick={close} aria-label="Dismiss">
        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {!toast.undo && <span className="feel__timer" style={{ animationDuration: `${duration}ms` }} />}
    </div>
  );
}

const CSS = `
.feel, .feel__toasts {
  --feel-bg: var(--sb-panel-bg, #fff);
  --feel-line: var(--sb-panel-border, #e5e7eb);
  --feel-ink: var(--sb-panel-text, #111827);
  --feel-dim: var(--sb-panel-text-dim, #8b93a1);
  --feel-accent: var(--modern-accent, var(--accent, #1f6feb));
  --feel-good: #12a150; --feel-bad: #e5484d;
  --feel-ease: cubic-bezier(.22,1,.36,1);
}
.feel { position: fixed; inset: 0; z-index: 700; display: flex; align-items: center; justify-content: center; padding: 20px; }
.feel__scrim { position: absolute; inset: 0; background: rgba(8,12,20,.5); backdrop-filter: blur(3px); animation: feel-fade .18s ease-out; }
.feel__dialog {
  position: relative; width: min(400px, 100%); padding: 22px 22px 18px; border-radius: 16px;
  background: var(--feel-bg); border: 1px solid var(--feel-line);
  box-shadow: 0 24px 70px rgba(0,0,0,.35); animation: feel-pop .26s var(--feel-ease);
}
.feel__dialogTitle { margin: 0; font-size: 16px; font-weight: 750; color: var(--feel-ink); line-height: 1.35; }
.feel__dialogBody { margin: 8px 0 0; font-size: 13px; line-height: 1.6; color: var(--feel-dim); }
.feel__dialogActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.feel__btn {
  padding: 9px 15px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 650;
  border: 1px solid var(--feel-line); background: transparent; color: var(--feel-ink);
  transition: background .15s, transform .12s, box-shadow .15s;
}
.feel__btn:hover { background: color-mix(in srgb, var(--feel-ink) 7%, transparent); }
.feel__btn:active { transform: scale(.97); }
.feel__btn--primary { border-color: transparent; background: var(--feel-accent); color: #fff; }
.feel__btn--primary:hover { background: color-mix(in srgb, var(--feel-accent) 86%, #000); }
.feel__btn--danger { background: var(--feel-bad); }
.feel__btn--danger:hover { background: color-mix(in srgb, var(--feel-bad) 86%, #000); }
.feel__btn:focus-visible { outline: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--feel-accent) 40%, transparent); }

.feel__toasts {
  position: fixed; z-index: 690; left: 50%; transform: translateX(-50%); bottom: 22px;
  display: flex; flex-direction: column; gap: 8px; width: min(420px, calc(100vw - 32px)); pointer-events: none;
}
.feel__toast {
  position: relative; overflow: hidden; pointer-events: auto;
  display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 14px;
  border-radius: 12px; background: var(--feel-bg); border: 1px solid var(--feel-line);
  box-shadow: 0 12px 34px rgba(0,0,0,.24); animation: feel-toast-in .3s var(--feel-ease);
}
.feel__toast.is-leaving { animation: feel-toast-in .18s ease-in reverse both; }
.feel__toastDot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--feel-accent); }
.feel__toast--success .feel__toastDot { background: var(--feel-good); }
.feel__toast--error .feel__toastDot { background: var(--feel-bad); }
.feel__toastText { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 600; color: var(--feel-ink); line-height: 1.45; }
.feel__undo {
  flex-shrink: 0; padding: 5px 10px; border-radius: 7px; cursor: pointer; font: inherit;
  font-size: 11.5px; font-weight: 700; color: var(--feel-accent);
  border: 1px solid color-mix(in srgb, var(--feel-accent) 40%, transparent); background: transparent;
  transition: background .15s;
}
.feel__undo:hover { background: color-mix(in srgb, var(--feel-accent) 12%, transparent); }
.feel__undo:disabled { opacity: .6; cursor: default; }
.feel__toastClose {
  flex-shrink: 0; width: 22px; height: 22px; border-radius: 6px; cursor: pointer;
  border: none; background: transparent; color: var(--feel-dim);
  display: flex; align-items: center; justify-content: center; transition: color .15s, background .15s;
}
.feel__toastClose:hover { color: var(--feel-ink); background: color-mix(in srgb, var(--feel-ink) 8%, transparent); }
.feel__timer {
  position: absolute; left: 0; bottom: 0; height: 2px; width: 100%;
  background: color-mix(in srgb, var(--feel-accent) 45%, transparent);
  transform-origin: left; animation: feel-timer linear forwards;
}
.feel__toast--success .feel__timer { background: color-mix(in srgb, var(--feel-good) 45%, transparent); }
.feel__toast--error .feel__timer { background: color-mix(in srgb, var(--feel-bad) 45%, transparent); }

@keyframes feel-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes feel-pop { from { opacity: 0; transform: translateY(10px) scale(.97) } to { opacity: 1; transform: none } }
@keyframes feel-toast-in { from { opacity: 0; transform: translateY(14px) scale(.97) } to { opacity: 1; transform: none } }
@keyframes feel-timer { from { transform: scaleX(1) } to { transform: scaleX(0) } }

@media (max-width: 640px) {
  .feel__toasts { bottom: 14px; }
  .feel__btn { padding: 11px 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .feel__scrim, .feel__dialog, .feel__toast { animation: none; }
  .feel__timer { display: none; }
  .feel *, .feel__toast * { transition-duration: .01ms !important; }
}
`;
