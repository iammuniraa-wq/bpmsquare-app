"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { STEP_IDS, STEP_PRIMARY, type StepId } from "@/lib/studio/types";
import { stepUrl, useStepRunner, type RunKind } from "./studioClient";
import { SEND_EVENT } from "./TalkStep";
import { OPEN_GROUP_EVENT } from "./ui";
import styles from "./studio.module.css";

// The two controls in the record header: the primary action (always "the next
// step") and Show me how (an optional, never-forced tour of the current step).

const RUN_FOR: Partial<Record<StepId, RunKind>> = { tell: "map", process: "fit", fit: "changes", changes: "plan" };

export function PrimaryAction({ studyId, step, reached, canEdit, hasMessages, sent }: {
  studyId: string; step: StepId; reached: number; canEdit: boolean; hasMessages: boolean; sent: boolean;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const { run, busy, busyMessage } = useStepRunner(studyId, setErr);
  const idx = STEP_IDS.indexOf(step);
  const nextStep = STEP_IDS[idx + 1];
  const label = step === "talk" && sent ? "Sent" : STEP_PRIMARY[step];
  // When the next step already exists, the primary button just goes there: it never silently re-runs the AI.
  const nextBuilt = reached > idx + 1;

  async function onClick() {
    setErr(null);
    if (step === "talk") { window.dispatchEvent(new Event(SEND_EVENT)); return; }
    if (step === "plan" || nextBuilt) { router.push(stepUrl(studyId, nextStep)); return; }
    const kind = RUN_FOR[step];
    if (kind) await run(kind);
  }

  const blocked = !canEdit && !nextBuilt && step !== "plan";
  const disabled = (step === "tell" && !hasMessages && !nextBuilt) || (step === "talk" && sent) || blocked;

  return (
    <span id="studioPrimary" style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {(busyMessage || err) && (
        <span className={styles.statusLine} role={err ? "alert" : "status"} style={err ? { color: "var(--err-ink)" } : undefined}>{err ?? busyMessage}</span>
      )}
      <Button variant="primary" loading={busy !== null} disabled={disabled} onClick={() => void onClick()}>{label}</Button>
    </span>
  );
}

// ── Show me how ──────────────────────────────────────────────────────────────

const TOURS: Record<StepId, [string, string][]> = {
  tell: [
    ["studioPrimary", "This is your study. The button on the right is always the next step. Nothing happens until you press it."],
    ["w1chat", "Tell us how you work, in your own words. We ask at most three questions back. Blue chips are what you said, amber what we assumed."],
    ["p1areas", "Or answer an area at a time. Switch off what does not apply."],
    ["p1docs", "Already have an SOP or a spreadsheet? Reading documents is coming; for now describe it or paste the text."],
  ],
  process: [
    ["w2map", "Your process, one lane per role. Change a step name or role if we got it wrong. On a phone this is a list by area."],
    ["p2roles", "The roles are the lanes. Add one if we missed somebody."],
  ],
  fit: [
    ["tiles", "Four numbers: how much is standard, how much needs setup, and what needs a change."],
    ["fit", "One line per step. Open a line for the why; tap a name to see exactly which module, screen or setting it is."],
    ["p3filter", "Show only the lines you care about."],
    ["reviewBanner", "It stays a draft until a person at BPMSquare has checked every line."],
  ],
  changes: [
    ["changes", "One card per change. The band says roughly how big it is, never a price."],
    ["p4kinds", "There are only five kinds of change in BPMSquare. Untick a kind to hide it."],
  ],
  plan: [
    ["w5gantt", "Your timeline. Pick a start date on the left and every date moves."],
    ["phases", "Open a phase, tick Looks right, change a duration, leave a comment."],
    ["p5dates", "Start date, weekend and a filter for just your tasks. Save is at the top of the page, or at the bottom on a phone."],
  ],
  talk: [
    ["w6sum", "The package in numbers."],
    ["p6send", "Your name and email, then Send. The version is frozen; we call within two working days."],
  ],
};

export function TourButton({ step }: { step: StepId }) {
  const [on, setOn] = useState(false);
  const [i, setI] = useState(0);
  const list = TOURS[step];

  const end = useCallback(() => {
    document.querySelectorAll(`.${styles.tourHl}`).forEach((el) => el.classList.remove(styles.tourHl));
    setOn(false);
  }, []);

  useEffect(() => { end(); setI(0); }, [step, end]);

  useEffect(() => {
    if (!on) return;
    document.querySelectorAll(`.${styles.tourHl}`).forEach((el) => el.classList.remove(styles.tourHl));
    const el = document.getElementById(list[i]?.[0] ?? "");
    if (!el) { end(); return; }
    if (el instanceof HTMLDetailsElement) el.open = true;
    window.dispatchEvent(new CustomEvent(OPEN_GROUP_EVENT, { detail: list[i][0] }));
    el.classList.add(styles.tourHl);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [on, i, list, end]);

  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") end(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [on, end]);

  useEffect(() => end, [end]);

  return (
    <>
      <Button onClick={() => { if (on) end(); else { setI(0); setOn(true); } }} aria-pressed={on}>Show me how</Button>
      {on && list[i] && (
        <div className={styles.tourCap} role="dialog" aria-live="polite" aria-label="Show me how">
          <div className={styles.tourN}>Show me how · {i + 1} of {list.length}</div>
          <div>{list[i][1]}</div>
          <div className={styles.tourBtns}>
            <Button size="sm" variant="quiet" onClick={end}>Skip</Button>
            <Button size="sm" disabled={i === 0} onClick={() => setI(i - 1)}>Back</Button>
            <Button size="sm" variant="primary" onClick={() => (i >= list.length - 1 ? end() : setI(i + 1))}>{i >= list.length - 1 ? "Done" : "Next"}</Button>
          </div>
        </div>
      )}
    </>
  );
}
