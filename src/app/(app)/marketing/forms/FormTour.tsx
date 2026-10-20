"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import styles from "../newsletters/newsletter.module.css";

// "Show me how" for the form builder: optional, closed by default, Next / Back / Skip, remembered
// per person in localStorage only (docs/marketing-platform-architecture.md 6.0). Same behaviour as
// the Newsletter Studio's tour, with its own remembered step.

export type TourStep = { target: string; text: string; before?: () => void | Promise<void> };

const KEY = "bpm.forms.tour.step";
const read = (): number => { try { const n = Number(localStorage.getItem(KEY)); return Number.isInteger(n) && n > 0 ? n : 0; } catch { return 0; } };
const write = (n: number) => { try { localStorage.setItem(KEY, String(n)); } catch { /* private window: the tour still works */ } };

export default function FormTour({ steps }: { steps: TourStep[] }) {
  const [i, setI] = useState<number | null>(null);

  const clear = useCallback(() => {
    document.querySelectorAll(`.${styles.tourHl}`).forEach((el) => el.classList.remove(styles.tourHl));
  }, []);
  const end = useCallback(() => { clear(); setI(null); }, [clear]);

  useEffect(() => {
    if (i === null) return;
    let cancelled = false;
    clear();
    void (async () => {
      await steps[i]?.before?.();
      await new Promise((r) => window.setTimeout(r, 120));
      if (cancelled) return;
      const el = document.getElementById(steps[i]?.target ?? "");
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.classList.add(styles.tourHl);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    })();
    write(i);
    return () => { cancelled = true; };
    // steps are re-created by the parent on every render; only the step index drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, clear]);

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
      <Button onClick={() => { if (i !== null) end(); else setI(Math.min(read(), steps.length - 1)); }} aria-pressed={i !== null} id="frTourBtn">Show me how</Button>
      {step && i !== null && (
        <div className={styles.tourCap} role="dialog" aria-live="polite" aria-label="Show me how">
          <div className={styles.tourN}>Step {i + 1} of {steps.length}</div>
          <div>{step.text}</div>
          <div className={styles.tourBtns}>
            <Button size="sm" variant="quiet" className={styles.skip} onClick={end}>Skip</Button>
            <Button size="sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</Button>
            <Button size="sm" variant="primary" onClick={() => (i >= steps.length - 1 ? (write(0), end()) : setI(i + 1))}>{i >= steps.length - 1 ? "Done" : "Next"}</Button>
          </div>
        </div>
      )}
    </>
  );
}
