"use client";

import { useEffect, useRef } from "react";
import { findGuideTarget } from "@/lib/assistant/screens/dom";
import type { GuideStep } from "@/lib/assistant/guide";

/** Where the current step's control stands on the page right now. */
export type GuideTargetState = "none" | "found" | "parent" | "missing";

export const GUIDE_HL_CLASS = "bms-guide-hl";

/**
 * The spotlight half of guide mode: the same mechanism as the marketing Tour (find the element, scroll it into view,
 * respect reduced motion, Escape leaves) pointed at data-guide ids instead of a studio's element ids. It renders
 * nothing of its own; the dock shows the numbered steps.
 *
 * It never presses anything for the person. The only thing it ever clicks is a tab, to open the tab a control lives
 * on (a view change, not an action); the control itself is highlighted and left alone. The step advances when the
 * person clicks or changes that control. A control inside a menu that is closed is not on the page: the menu's own
 * button is highlighted until the control appears.
 */
export default function GuideOverlay({ step, onAdvance, onStop, onState }: {
  step: GuideStep | null;
  onAdvance: () => void;
  onStop: () => void;
  onState?: (s: GuideTargetState) => void;
}) {
  const advanceRef = useRef(onAdvance);
  advanceRef.current = onAdvance;
  const stopRef = useRef(onStop);
  stopRef.current = onStop;
  const stateRef = useRef(onState);
  stateRef.current = onState;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") stopRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const key = step ? `${step.control ?? ""}|${step.tab ?? ""}|${step.within ?? ""}|${step.domId ?? ""}|${step.hidden ? "h" : ""}` : "";

  useEffect(() => {
    if (!step || !step.control || step.hidden) { stateRef.current?.("none"); return; }
    const control = step.control;
    let cancelled = false;
    let highlighted: HTMLElement | null = null;
    let listening: HTMLElement | null = null;
    let frame = 0;

    const detach = () => {
      if (listening) { listening.removeEventListener("click", onDone, true); listening.removeEventListener("change", onDone, true); }
      listening = null;
    };
    const clear = () => { highlighted?.classList.remove(GUIDE_HL_CLASS); highlighted = null; detach(); };
    function onDone() { window.setTimeout(() => { if (!cancelled) advanceRef.current(); }, 250); }

    const resolve = () => {
      if (cancelled) return;
      const real = findGuideTarget(control, step.domId);
      const target = real ?? (step.within ? findGuideTarget(step.within) : null);
      if (target === highlighted) return;
      clear();
      highlighted = target;
      if (!target) { stateRef.current?.("missing"); return; }
      if (target instanceof HTMLDetailsElement) target.open = true;
      target.classList.add(GUIDE_HL_CLASS);
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      if (real) {
        real.addEventListener("click", onDone, true);
        real.addEventListener("change", onDone, true);
        listening = real;
      }
      stateRef.current?.(real ? "found" : "parent");
    };

    // A menu opening, a tab switching or a panel loading changes what is on the page: look again.
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(resolve); });

    void (async () => {
      if (step.tab) {
        const tab = document.querySelector<HTMLElement>(`[data-guide="${CSS.escape(`tab:${step.tab}`)}"]`);
        if (tab && tab.getAttribute("aria-selected") !== "true") {
          tab.click();
          await new Promise((r) => window.setTimeout(r, 160));
        }
      }
      if (cancelled) return;
      resolve();
      observer.observe(document.body, { childList: true, subtree: true });
    })();

    return () => { cancelled = true; observer.disconnect(); cancelAnimationFrame(frame); clear(); };
    // The step object is rebuilt on every render of the dock; only what identifies the target may restart the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return null;
}
