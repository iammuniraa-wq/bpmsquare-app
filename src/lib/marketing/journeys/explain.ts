import { describeCondition, dayOffsets, triggerLabel } from "./definition";
import { weekdayName, type JourneyLimits } from "./safety";
import type { JourneyDefinition, JourneyStep } from "./types";

// "Why this step will fire" and "why it will not", written by code from the
// step's own conditions and the workspace's rules, so the sentence under a step
// can never disagree with what the runner does. Pure.

export type StepExplanation = {
  /** One line: when and under which conditions this step runs. */
  fires: string;
  /** The rules that can stop it, each with the reason code the run log will use. */
  blockers: { code: string; text: string }[];
};

const pad = (n: number) => String(n).padStart(2, "0");

function sinceTrigger(def: JourneyDefinition, index: number): string {
  const days = dayOffsets(def.steps)[index] ?? 0;
  const start = triggerLabel(def.trigger.event).replace(/^An? /, (m) => m.toLowerCase());
  const cond = describeCondition(def.trigger.condition).replace(/^An? /, (m) => m.toLowerCase());
  const what = cond ? `${start}, if it is ${cond}` : start;
  if (days === 0) return `straight away once ${what}`;
  const d = days >= 1 ? `${Math.round(days * 10) / 10} day${days === 1 ? "" : "s"}` : `${Math.round(days * 24)} hours`;
  return `${d} after ${what}`;
}

export function explainStep(def: JourneyDefinition, index: number, limits: JourneyLimits, opts: { topicLabel?: (key: string | null) => string } = {}): StepExplanation {
  const s: JourneyStep | undefined = def.steps[index];
  if (!s) return { fires: "", blockers: [] };
  const quiet = `${pad(limits.quietFromHour)}:00 to ${pad(limits.quietToHour)}:00`;
  const days = limits.offWeekdays.map(weekdayName).join(" and ");
  switch (s.kind) {
    case "wait":
      return { fires: `Counts ${s.amount} ${s.unit === "hours" ? "hour" : "day"}${s.amount === 1 ? "" : "s"} from the step before, then the person moves on.`, blockers: [] };
    case "send_newsletter": {
      const topic = opts.topicLabel?.(s.topic) ?? (s.topic ?? "this subject");
      const blockers = [
        { code: "no_consent", text: `Will not send if the person has no consent for ${topic}, withdrew it, or is suppressed. Consent is checked again at the moment of sending.` },
        { code: "quiet_hours", text: `Waits if it is ${quiet}${days ? ` or ${days}` : ""} in workspace time.` },
        { code: "daily_cap", text: `Waits if the person already had ${limits.maxPerDay === 1 ? "a journey email" : `${limits.maxPerDay} journey emails`} in the last 24 hours.` },
      ];
      if (def.entry.pause_when_in_trouble) blockers.push({ code: "account_in_trouble", text: `Waits while the company has a case open for more than ${limits.troubleCaseDays} days or an overdue invoice.` });
      return { fires: `Sends ${sinceTrigger(def, index)}, if the person has consent for ${topic} and none of the rules below apply.`, blockers };
    }
    case "create_task":
      return {
        fires: `Creates the task ${sinceTrigger(def, index)} for the company's owner (Coverage), due in ${s.due_in_days} day${s.due_in_days === 1 ? "" : "s"}.`,
        blockers: [{ code: "no_owner", text: "If nobody owns the company yet the task is still created, but unassigned." }],
      };
    case "notify_owner":
      return { fires: `Tells the company's owner ${sinceTrigger(def, index)}.`, blockers: [{ code: "no_owner", text: "If nobody owns the company yet nobody is told, and the log says so." }] };
    case "end":
      return { fires: "The journey finishes here for this person.", blockers: [] };
  }
}

/** The line under the whole journey: who enters, and who never does. */
export function explainEntry(def: JourneyDefinition): { fires: string; blockers: { code: string; text: string }[] } {
  const cond = describeCondition(def.trigger.condition);
  return {
    fires: `A person enters when ${triggerLabel(def.trigger.event).toLowerCase()}${cond ? ` and it is ${cond}` : ""}${def.entry.lookback_days > 0 ? `, including the last ${def.entry.lookback_days} day${def.entry.lookback_days === 1 ? "" : "s"} when you turn it on` : ""}.`,
    blockers: [
      { code: "already_enrolled", text: `Nobody enters twice${def.entry.one_per_account ? ", and only one person per company enters" : ""}.` },
      { code: "no_contact", text: "Nobody enters if the event does not name a person or a company with a contact." },
    ],
  };
}
