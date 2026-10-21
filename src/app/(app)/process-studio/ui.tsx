"use client";

import { useEffect, useId, useState } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import SharedOptionGroup from "@/components/ui/OptionGroup";
import { Opt as SharedOpt } from "@/components/ui/Opt";
import type { CapabilityView } from "@/lib/studio/types";
import { RATING_LABEL, type Rating } from "@/lib/studio/types";
import styles from "./studio.module.css";

// Small building blocks shared by the six steps. Labels, values and actions only: every explanation goes in `info`
// and sits behind the shared "i" (docs/design/ux-simplification.md); the texts live in src/lib/studio/tips.ts.

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");

export function RatingPill({ rating }: { rating: Rating }) {
  return <span className={cx(styles.pill, styles[rating])}>{RATING_LABEL[rating]}</span>;
}

/** Fired to open a group from outside it (a "+ Add step" button, the guided walkthrough). The detail is the group's id. */
export const OPEN_GROUP_EVENT = "studio:open-group";

/**
 * One collapsible group in the left panel: the shared OptionGroup (a header row with its own "i"), holding its own
 * open state. `id` lets the guided walkthrough find it and open it.
 */
export function OptionGroup({ id, title, info, defaultOpen = false, children }: {
  id?: string; title: string; info?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const auto = useId();
  const gid = id ?? `og${auto.replace(/:/g, "")}`;
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    const h = (e: Event) => { if ((e as CustomEvent<string>).detail === gid) setOpen(true); };
    window.addEventListener(OPEN_GROUP_EVENT, h);
    return () => window.removeEventListener(OPEN_GROUP_EVENT, h);
  }, [gid]);
  return (
    <SharedOptionGroup id={gid} title={title} info={info} open={open} onToggle={() => setOpen((o) => !o)}>{children}</SharedOptionGroup>
  );
}

/** One option: a label (with its "i" when it has an explanation) above the control. `hint` is a constraint of a few words only. */
export function Opt({ label, info, hint, children, htmlFor }: { label: string; info?: React.ReactNode; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return <SharedOpt label={label} info={info} hint={hint} htmlFor={htmlFor}>{children}</SharedOpt>;
}

export function Switch({ label, info, checked, onChange, disabled }: {
  label: string; info?: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={styles.opt}>
      <div className={styles.optLabel}>
        <span className="bpm-label-row"><label htmlFor={id}>{label}</label>{info ? <InfoTip label={label}>{info}</InfoTip> : null}</span>
        <input id={id} type="checkbox" role="switch" className={styles.sw} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </div>
    </div>
  );
}

/** A group's empty state: what is missing, in a few words, and the next step. */
export function MiniEmpty({ title, text }: { title: string; text: string }) {
  return <div className={styles.emptyMini}><b>{title}</b><span>{text}</span></div>;
}

export function Tuck({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <details className={styles.tuck}>
      <summary>{title}{note ? <small>{note}</small> : null}</summary>
      <div className={styles.tuckIn}>{children}</div>
    </details>
  );
}

export function Head({ title, info, children }: { title: string; info?: string; children?: React.ReactNode }) {
  return (
    <div className={styles.head}>
      <div>{info ? <span className="bpm-label-row"><h2>{title}</h2><InfoTip label={title}>{info}</InfoTip></span> : <h2>{title}</h2>}</div>
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
