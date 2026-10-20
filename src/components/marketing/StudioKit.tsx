"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import styles from "@/app/(app)/marketing/journeys/journey.module.css";

// The two pieces every studio-type screen of the small marketing modules shares (platform rule,
// docs/marketing-platform-architecture.md section 6.0): a collapsible option group with a one-line hint always
// visible, and the optional "Show me how" walkthrough. They use the Journey builder's stylesheet so the
// studios look alike; colours come only from the theme variables in globals.css.

export { styles as studio };
export const cx = (...p: (string | false | null | undefined)[]): string => p.filter(Boolean).join(" ");

const Chevron = () => (
  <svg className={styles.chev} viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

export function Group({ id, title, summary, hint, open, onToggle, children }: {
  id: string; title: string; summary: string; hint: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <section className={cx(styles.sec, open && styles.open)} id={id}>
      <button type="button" className={styles.sech} aria-expanded={open} aria-controls={`${id}Body`} onClick={onToggle}>
        <b>{title}</b><span className={styles.sum}>{summary}</span><span className={styles.hint}>{hint}</span><Chevron />
      </button>
      <div className={styles.in} id={`${id}Body`} hidden={!open}>{children}</div>
    </section>
  );
}

export type TourStep = { target: string; text: string; before?: () => void };

const read = (key: string): number => { try { const n = Number(localStorage.getItem(key)); return Number.isInteger(n) && n > 0 ? n : 0; } catch { return 0; } };
const write = (key: string, n: number) => { try { localStorage.setItem(key, String(n)); } catch { /* private window: the tour still works */ } };

/** "Show me how": optional, closed by default, Next / Back / Skip, remembered per person in localStorage only. */
export function StudioTour({ steps, storageKey }: { steps: TourStep[]; storageKey: string }) {
  const [i, setI] = useState<number | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const clear = useCallback(() => {
    document.querySelectorAll(`.${styles.tourHl}`).forEach((el) => el.classList.remove(styles.tourHl));
  }, []);
  const end = useCallback(() => { clear(); setI(null); }, [clear]);

  useEffect(() => {
    if (i === null) return;
    clear();
    const step = stepsRef.current[i];
    step?.before?.();
    const t = window.setTimeout(() => {
      const el = document.getElementById(step?.target ?? "");
      if (!el) return;
      el.classList.add(styles.tourHl);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }, 80);
    write(storageKey, i);
    return () => window.clearTimeout(t);
  }, [i, clear, storageKey]);

  useEffect(() => {
    if (i === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") end(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [i, end]);

  useEffect(() => end, [end]);

  const step = i !== null ? steps[i] : null;
  return (
    <>
      <Button onClick={() => { if (i !== null) end(); else setI(Math.min(read(storageKey), steps.length - 1)); }} aria-pressed={i !== null}>Show me how</Button>
      {step && i !== null && (
        <div className={styles.tourCap} role="dialog" aria-live="polite" aria-label="Show me how">
          <div className={styles.tourN}>Step {i + 1} of {steps.length}</div>
          <div>{step.text}</div>
          <div className={styles.tourBtns}>
            <Button size="sm" variant="quiet" className={styles.skip} onClick={end}>Skip</Button>
            <Button size="sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</Button>
            <Button size="sm" variant="primary" onClick={() => (i >= steps.length - 1 ? (write(storageKey, 0), end()) : setI(i + 1))}>{i >= steps.length - 1 ? "Done" : "Next"}</Button>
          </div>
        </div>
      )}
    </>
  );
}
