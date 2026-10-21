"use client";

import Card from "@/components/ui/Card";
import s from "./middleware.module.css";
import { TAB_LABEL, type SetupStatus, type TabId } from "./setup";
import { MIDDLEWARE_TIPS } from "./tips";
import { CheckIcon } from "./ui";

/**
 * Five ticks with live status, each opening the tab where it is done. Once all
 * five are ticked it folds into a small "Set-up complete" chip.
 */
export default function SetupGuide({ status, loading, onOpen }: { status: SetupStatus; loading: boolean; onOpen: (tab: TabId) => void }) {
  if (status.complete) {
    return (
      <div>
        <span className={s.doneChip}><CheckIcon size={13} /> Set-up complete</span>
      </div>
    );
  }
  return (
    <Card title="Set up" info={MIDDLEWARE_TIPS.setup} padding={14} action={<span className={`${s.small} ${s.muted}`} aria-live="polite">{loading ? "Checking…" : `${status.doneCount} of ${status.steps.length}`}</span>}>
      <ol className={s.guideSteps} style={{ marginTop: 0 }}>
        {status.steps.map((step, i) => (
          <li key={step.id} className={step.done ? s.stepDone : undefined}>
            <button type="button" className={s.step} onClick={() => onOpen(step.tab)}>
              <span className={s.stepIcon} aria-hidden="true">{step.done ? <CheckIcon size={13} /> : i + 1}</span>
              <span>
                <span className={s.stepLabel}>{step.label}</span>
                <span className={s.stepState}>{step.state}</span>
              </span>
              <span className="bpm-sr-only">{step.done ? ", done" : ", not done"}. Opens {TAB_LABEL[step.tab]}.</span>
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}
