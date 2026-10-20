"use client";

import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import styles from "./journey.module.css";

// "Show me how": an optional, step-by-step walk through the builder. It never starts on its own, is closed by
// default, and can be left at any step with Skip or Escape. The step a person reached is remembered in
// localStorage only (the platform rule, docs/marketing-platform-architecture.md section 6.0).

export type TourStep = { target: string; text: string };

const KEY = "bpm.journey.tour.step";
const read = (): number => { try { const n = Number(localStorage.getItem(KEY)); return Number.isInteger(n) && n > 0 ? n : 0; } catch { return 0; } };
const write = (n: number) => { try { localStorage.setItem(KEY, String(n)); } catch { /* private window: the tour still works */ } };

export default function JourneyTour({ steps }: { steps: TourStep[] }) {
  const [i, setI] = useState<number | null>(null);

  const clear = useCallback(() => {
    document.querySelectorAll(`.${styles.tourHl}`).forEach((el) => el.classList.remove(styles.tourHl));
  }, []);
  const end = useCallback(() => { clear(); setI(null); }, [clear]);

  useEffect(() => {
    if (i === null) return;
    clear();
    const t = window.setTimeout(() => {
      const el = document.getElementById(steps[i]?.target ?? "");
      if (!el) return;
      el.classList.add(styles.tourHl);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    }, 80);
    write(i);
    return () => window.clearTimeout(t);
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
      <Button onClick={() => { if (i !== null) end(); else setI(Math.min(read(), steps.length - 1)); }} aria-pressed={i !== null} id="jnTourBtn">Show me how</Button>
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
