"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import journey from "@/app/(app)/marketing/journeys/journey.module.css";
import { findGuideTarget } from "@/lib/assistant/screens/dom";

// The one "Show me how" for every marketing studio: optional, closed by default, never starts on its own, left at any
// step with Skip or Escape. The step a person reached is remembered in localStorage only (platform rule,
// docs/marketing-platform-architecture.md section 6.0) and used to resume when the button is pressed again.

export type TourStep = {
  /** id of the element to highlight, or the data-guide id of a control a component has registered. */
  target: string;
  text: string;
  /** What the step does first, so the person sees the real thing: switch a tab, open a group, select a block. */
  before?: () => void | Promise<void>;
};

/** The look-and-feel class names. Studios share the journey stylesheet's; a screen with its own look passes its own. */
export type TourClasses = { hl: string; cap: string; n: string; btns: string; skip?: string };

const STUDIO_CLASSES: TourClasses = { hl: journey.tourHl, cap: journey.tourCap, n: journey.tourN, btns: journey.tourBtns, skip: journey.skip };

const read = (key: string): number => { try { const n = Number(localStorage.getItem(key)); return Number.isInteger(n) && n > 0 ? n : 0; } catch { return 0; } };
const write = (key: string, n: number) => { try { localStorage.setItem(key, String(n)); } catch { /* private window: the tour still works */ } };

export default function Tour({ steps, storageKey, buttonId, classes = STUDIO_CLASSES }: {
  steps: TourStep[]; storageKey: string; buttonId?: string; classes?: TourClasses;
}) {
  const [i, setI] = useState<number | null>(null);
  // Parents rebuild the steps on every render; only the step index may drive the effect below.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const clear = useCallback(() => {
    document.querySelectorAll(`.${classes.hl}`).forEach((el) => el.classList.remove(classes.hl));
  }, [classes.hl]);
  const end = useCallback(() => { clear(); setI(null); }, [clear]);

  useEffect(() => {
    if (i === null) return;
    let cancelled = false;
    clear();
    void (async () => {
      await stepsRef.current[i]?.before?.();
      // Let the panel and the preview settle after the step changed them.
      await new Promise((r) => window.setTimeout(r, 120));
      if (cancelled) return;
      const el = findGuideTarget(stepsRef.current[i]?.target ?? "");
      if (!el) return;
      if (el instanceof HTMLDetailsElement) el.open = true;
      el.classList.add(classes.hl);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    })();
    write(storageKey, i);
    return () => { cancelled = true; };
  }, [i, clear, storageKey, classes.hl]);

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
      <Button onClick={() => { if (i !== null) end(); else setI(Math.min(read(storageKey), steps.length - 1)); }} aria-pressed={i !== null} id={buttonId}>Show me how</Button>
      {step && i !== null && (
        <div className={classes.cap} role="dialog" aria-live="polite" aria-label="Show me how">
          <div className={classes.n}>Step {i + 1} of {steps.length}</div>
          <div>{step.text}</div>
          <div className={classes.btns}>
            <Button size="sm" variant="quiet" className={classes.skip} onClick={end}>Skip</Button>
            <Button size="sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</Button>
            <Button size="sm" variant="primary" onClick={() => (i >= steps.length - 1 ? (write(storageKey, 0), end()) : setI(i + 1))}>{i >= steps.length - 1 ? "Done" : "Next"}</Button>
          </div>
        </div>
      )}
    </>
  );
}
