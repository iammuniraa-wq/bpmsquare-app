"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { STEP_IDS, STEP_LABEL, type CapabilityView, type StepId, type StudyBundle } from "@/lib/studio/types";
import ChangesStep from "./ChangesStep";
import FitStep from "./FitStep";
import PlanStep from "./PlanStep";
import ProcessStep from "./ProcessStep";
import TalkStep from "./TalkStep";
import TellStep from "./TellStep";
import { stepUrl, type StepProps } from "./studioClient";
import { CapabilityDialog, cx } from "./ui";
import styles from "./studio.module.css";

/**
 * The studio layout (owner rule, Newsletter Studio review): the stepper across the
 * top, then options in a left panel and the workspace on the right; under 900px the
 * panel sits above the workspace. The panel and workspace of each step are one
 * component returning both, so the two columns can share that step's state.
 */
export default function StudioScreen({ bundle, step, canEdit, caps }: {
  bundle: StudyBundle; step: StepId; canEdit: boolean; caps: Record<string, CapabilityView>;
}) {
  const router = useRouter();
  const [toastText, setToastText] = useState<string | null>(null);
  const [openCapId, setOpenCapId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reached = bundle.study.reached;

  const toast = useCallback((m: string) => {
    setToastText(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastText(null), 4200);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const props: StepProps = {
    bundle, canEdit, caps, toast,
    refresh: () => router.refresh(),
    openCap: (id) => setOpenCapId(id),
  };

  return (
    <div className={styles.accent}>
      <nav className={styles.stepper} aria-label="Steps">
        {STEP_IDS.map((id, i) => {
          const n = i + 1;
          const locked = n > reached;
          const cls = cx(styles.stepb, id === step && styles.active, id !== step && n < reached && styles.done, locked && styles.locked);
          return (
            <Link key={id} href={stepUrl(bundle.study.id, id)} scroll={false} className={cls} aria-current={id === step ? "step" : undefined} aria-disabled={locked || undefined} tabIndex={locked ? -1 : undefined}>
              <i>{n < reached && id !== step ? "✓" : n}</i><span className={styles.lbl}>{STEP_LABEL[id]}</span>
            </Link>
          );
        })}
      </nav>

      <div className={styles.studio}>
        {step === "tell" && <TellStep {...props} />}
        {step === "process" && <ProcessStep {...props} />}
        {step === "fit" && <FitStep {...props} />}
        {step === "changes" && <ChangesStep {...props} />}
        {step === "plan" && <PlanStep {...props} />}
        {step === "talk" && <TalkStep {...props} />}
      </div>

      {openCapId && caps[openCapId] && <CapabilityDialog cap={caps[openCapId]} onClose={() => setOpenCapId(null)} />}
      {toastText && <div className={styles.toast} role="status">{toastText}</div>}
    </div>
  );
}
