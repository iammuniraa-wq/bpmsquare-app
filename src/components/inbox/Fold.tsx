"use client";

import { useEffect, useRef, useState } from "react";
import s from "./inbox.module.css";

/**
 * A section that opens and closes and remembers which way the person left it (bpmsquarecore 3c rule 4). A native
 * <details>, so the keyboard and screen readers work as they should. The remembered state lives in this browser only
 * (a convenience): with storage blocked the section simply starts as `defaultOpen`.
 */
export default function Fold({ id, title, defaultOpen = true, children, guide, anchor }: {
  id: string; title: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode; guide?: string;
  /** An element id, so a link on the page (the phone's "2 files" chip) can jump here. */
  anchor?: string;
}) {
  const key = `inbox.fold.${id}`;
  const [open, setOpen] = useState(defaultOpen);
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(key);
      if (v === "1" || v === "0") setOpen(v === "1");
    } catch { /* storage is a convenience */ }
  }, [key]);

  return (
    <details
      ref={ref} id={anchor} className={s.fold} open={open} data-guide={guide}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        try { window.localStorage.setItem(key, next ? "1" : "0"); } catch { /* ignore */ }
      }}
    >
      <summary>{title}</summary>
      <div className={s.foldBody}>{children}</div>
    </details>
  );
}
