"use client";

import { useEffect, useRef, useState } from "react";
import InfoTip from "@/components/ui/InfoTip";
import s from "./middleware.module.css";
import { MIDDLEWARE_TIPS } from "./tips";

/** "Propose": fill the empty lines by name, replace everything, or (when the AI assistant is on) ask for the rest. */
export default function ProposeMenu({ disabled, busy, aiAvailable, onFill, onReplace, onAi }: {
  disabled: boolean; busy: boolean; aiAvailable: boolean; onFill: () => void; onReplace: () => void; onAi: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <span className={s.row}>
      <div className="bpm-menu-wrap" ref={ref}>
        <button type="button" className="bpm-btn bpm-btn-secondary bpm-btn-sm" aria-haspopup="menu" aria-expanded={open} disabled={disabled || busy} onClick={() => setOpen((o) => !o)}>
          {busy ? "Working…" : "Propose"} <span aria-hidden="true">▾</span>
        </button>
        {open && (
          <div role="menu" aria-label="Propose" className="bpm-menu">
            <button type="button" role="menuitem" className="bpm-menu-item" onClick={pick(onFill)}>Propose by name</button>
            <button type="button" role="menuitem" className="bpm-menu-item" onClick={pick(onReplace)}>Replace all by name…</button>
            {aiAvailable && <button type="button" role="menuitem" className="bpm-menu-item" onClick={pick(onAi)}>Ask AI for the empty lines</button>}
          </div>
        )}
      </div>
      <InfoTip label="Propose">{MIDDLEWARE_TIPS.propose}</InfoTip>
      {aiAvailable && <InfoTip label="Ask AI">{MIDDLEWARE_TIPS.proposeAi}</InfoTip>}
    </span>
  );
}
