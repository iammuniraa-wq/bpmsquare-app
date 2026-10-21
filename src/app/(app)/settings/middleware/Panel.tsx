"use client";

import { useEffect, useRef } from "react";
import s from "./middleware.module.css";

/**
 * A side panel on a desktop, a bottom sheet under 780 px. Escape and the backdrop close it; focus goes to Close
 * when it opens. `footer` stays at the bottom of the panel (the one primary action lives there).
 */
export default function Panel({ title, subtitle, onClose, children, footer, label }: {
  title: string;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  label?: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className={s.backdrop} onClick={onClose} />
      <aside className={s.drawer} role="dialog" aria-modal="true" aria-label={label ?? title}>
        <div className={s.rowBetween}>
          <div style={{ minWidth: 0 }}>
            <div className="bpm-t-section" style={{ overflowWrap: "anywhere" }}>{title}</div>
            {subtitle ? <div className={`${s.small} ${s.muted}`}>{subtitle}</div> : null}
          </div>
          <button ref={closeRef} type="button" className="bpm-btn bpm-btn-secondary bpm-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className={s.stack} style={{ gap: 16 }}>{children}</div>
        {footer ? <div className={s.panelFooter}>{footer}</div> : null}
      </aside>
    </>
  );
}
