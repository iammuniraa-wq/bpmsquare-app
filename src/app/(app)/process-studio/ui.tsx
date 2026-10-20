"use client";

import { useEffect, useId } from "react";
import Button from "@/components/ui/Button";
import type { CapabilityView } from "@/lib/studio/types";
import { RATING_LABEL, type Rating } from "@/lib/studio/types";
import styles from "./studio.module.css";

// Small building blocks shared by the six steps.

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");

export function RatingPill({ rating }: { rating: Rating }) {
  return <span className={cx(styles.pill, styles[rating])}>{RATING_LABEL[rating]}</span>;
}

/**
 * One collapsible group in the left panel (owner rule, Newsletter review: every
 * option group is collapsible, the group in use open, the rest closed). A native
 * details/summary, so it is keyboard-accessible with no extra code; `id` lets
 * the guided walkthrough find it.
 */
export function OptionGroup({ id, title, hint, defaultOpen = false, children }: {
  id?: string; title: string; hint: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  return (
    <details className={styles.grp} id={id} open={defaultOpen || undefined}>
      <summary>
        <span><b>{title}</b><span className={styles.ghint}>{hint}</span></span>
        <svg className={styles.chev} viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className={styles.grpIn}>{children}</div>
    </details>
  );
}

/** One option: a label, the control, and the one-line plain-words hint every option must carry. */
export function Opt({ label, hint, children, htmlFor }: { label: string; hint: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className={styles.opt}>
      {htmlFor ? <label className={styles.optLabel} htmlFor={htmlFor}>{label}</label> : <div className={styles.optLabel}>{label}</div>}
      {children}
      <span className={styles.optHint}>{hint}</span>
    </div>
  );
}

export function Switch({ label, hint, checked, onChange, disabled }: {
  label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={styles.opt}>
      <label className={styles.optLabel} htmlFor={id}>
        {label}
        <input id={id} type="checkbox" role="switch" className={styles.sw} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </label>
      <span className={styles.optHint}>{hint}</span>
    </div>
  );
}

export function Tuck({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <details className={styles.tuck}>
      <summary>{title}{note ? <small>{note}</small> : null}</summary>
      <div className={styles.tuckIn}>{children}</div>
    </details>
  );
}

export function Head({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className={styles.head}>
      <div><h2>{title}</h2>{sub ? <p className={styles.sub}>{sub}</p> : null}</div>
      {children}
    </div>
  );
}

/** What a catalogue id is: the dialog behind every blue name on the fit report. */
export function CapabilityDialog({ cap, onClose }: { cap: CapabilityView; onClose: () => void }) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.modalBox}>
        <h3 id={titleId}>{cap.label}</h3>
        <p style={{ margin: 0 }}>{cap.plain}</p>
        <dl className={styles.kv}>
          <dt>Kind</dt><dd>{cap.kind.replace(/_/g, " ")}</dd>
          {cap.module ? (<><dt>Module</dt><dd>{cap.module}</dd></>) : null}
          {cap.where ? (<><dt>Where</dt><dd>{cap.where}</dd></>) : null}
          <dt>Status</dt><dd>{cap.status}</dd>
          <dt>Catalogue id</dt><dd className={styles.mono}>{cap.id}</dd>
          <dt>Generated from</dt><dd className={styles.mono}>{cap.source}</dd>
        </dl>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={onClose} autoFocus>Close</Button>
        </div>
      </div>
    </div>
  );
}
