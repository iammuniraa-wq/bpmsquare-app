"use client";

import { useEffect, useRef } from "react";
import Button from "@/components/ui/Button";
import InfoTip from "@/components/ui/InfoTip";
import { STEP_LABEL, type Checklist, type NextStep, type StepId, type StepState, type TabJump } from "@/lib/tender/steps";
import { TENDER_TIPS } from "@/lib/tender/tips";
import s from "./TenderStepper.module.css";

/**
 * The path of a tender (KAMCO feedback slice 2): the steps from the email to the outcome, one Next row with the one button that moves
 * it on, and a closed list of what is already done. The stage's header button is handed in (`primaryButton`), so its guide ids, labels
 * and sizes stay what they were; a jump to a tab is drawn here.
 */
export default function TenderStepper({ steps, current, next, checklist, onJump, primaryButton }: {
  steps: { id: StepId; state: StepState }[];
  current?: StepId;
  next: NextStep;
  checklist: Checklist;
  /** Jump to the tab where the next step is done (and, for the BOQ, the filter to show). */
  onJump: (to: Pick<TabJump, "tab" | "filter">) => void;
  /** The stage's header button, drawn inside the Next row when the next step is that button (or after the jump, when it still applies). */
  primaryButton?: React.ReactNode;
}) {
  const done = checklist.filter((x) => x.done).length;
  const lead = next.primary;
  const listRef = useRef<HTMLOListElement>(null);
  // On a phone the steps scroll sideways; bring the current one into view so the person sees where they are.
  useEffect(() => {
    const list = listRef.current;
    const cur = list?.querySelector<HTMLElement>("[aria-current=\"step\"]");
    if (list && cur) list.scrollLeft = Math.max(0, cur.offsetLeft - list.clientWidth / 2 + cur.clientWidth / 2);
  }, [current]);
  return (
    <div className={s.wrap}>
      <div className={s.stepsRow}>
        <ol ref={listRef} className={s.steps} data-guide="tender.steps" aria-label="Tender steps">
          {steps.map((st, i) => (
            <li key={st.id} className={s.step} data-step={st.id} data-state={st.state} aria-current={st.id === current && st.state !== "skipped" ? "step" : undefined}>
              <span className={s.dot} aria-hidden="true">{st.state === "done" ? "✓" : i + 1}</span>
              <span className={s.label}>{STEP_LABEL[st.id]}</span>
            </li>
          ))}
        </ol>
        <InfoTip label="Tender steps">{TENDER_TIPS.steps}</InfoTip>
      </div>
      <div className={s.next} data-guide="tender.next">
        <div className={s.nextText}>
          <div className={s.nextTitle}>{next.title}<InfoTip label={next.title}>{TENDER_TIPS[next.tipKey]}</InfoTip></div>
          <div className={s.nextDetail}>{next.detail}</div>
        </div>
        <div className={s.buttons}>
          {lead?.kind === "tab" && (
            <Button variant="primary" onClick={() => onJump({ tab: lead.tab, filter: lead.filter })} data-guide={lead.guide} style={{ minHeight: 44 }}>{lead.label}</Button>
          )}
          {next.secondary && (
            <Button variant="secondary" onClick={() => onJump({ tab: next.secondary!.tab, filter: next.secondary!.filter })} data-guide={next.secondary.guide} style={{ minHeight: 44 }}>{next.secondary.label}</Button>
          )}
          {primaryButton}
        </div>
      </div>
      {checklist.length > 0 && (
        <details className={s.checklist} data-guide="tender.checklist">
          <summary>This step: {done} of {checklist.length} checks done</summary>
          <ul>
            {checklist.map((x) => (
              <li key={x.label} data-done={x.done}><span className={s.tick} aria-hidden="true">{x.done ? "✓" : "○"}</span><span>{x.label}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
