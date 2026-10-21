"use client";

import { useEffect, useRef } from "react";
import s from "./SidePanel.module.css";

/**
 * A side panel on a desktop, a bottom sheet under 780 px. Escape and the backdrop close it; focus goes to Close
 * when it opens. `footer` stays at the bottom of the panel (the one primary action lives there). A generalised
 * copy of the Integration middleware panel; that page keeps its own until the owner validates, then they merge.
 */
export default function SidePanel({ title, subtitle, onClose, children, footer, label }: {
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
      <aside className={s.panel} role="dialog" aria-modal="true" aria-label={label ?? title}>
        <div className={s.head}>
          <div className={s.headText}>
            <div className={`bpm-t-section ${s.title}`}>{title}</div>
            {subtitle ? <div className={s.sub}>{subtitle}</div> : null}
          </div>
          <button ref={closeRef} type="button" className="bpm-btn bpm-btn-secondary bpm-btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className={s.body}>{children}</div>
        {footer ? <div className={s.foot}>{footer}</div> : null}
      </aside>
    </>
  );
}
