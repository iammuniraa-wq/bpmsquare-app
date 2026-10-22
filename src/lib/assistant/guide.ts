import type Anthropic from "@anthropic-ai/sdk";
import { cleanText } from "./screens/filter";
import { fieldControlId } from "./screens";
import type { Task, VisibleScreen } from "./screens/types";

// Guide mode: a how-to answer is a `guide` tool call, not prose. The steps may only name controls of the screen the
// person is on (checked here against the manifest, not trusted from the model), and a control this person cannot use
// comes back marked hidden with its reason, never as something to press. The tool only returns data; there is no path
// from here to a write, and the page is never clicked for the person (docs/design/assistant-smarter.md 1.4).

export type GuideStep = {
  /** A data-guide id from the manifest; absent for a plain instruction. */
  control?: string;
  label?: string;
  text: string;
  /** Tab that must be open first; the overlay switches to it. */
  tab?: string;
  /** When the control is not on the page, point at this one (the menu that holds it). */
  within?: string;
  /** Element id for the studios' Tour targets. */
  domId?: string;
  hidden?: { reason: string; alternative?: string };
};

export type GuideReply = { task: string; steps: GuideStep[] };

export const MAX_GUIDE_STEPS = 12;

export const GUIDE_TOOL_NAME = "guide";

/** Offered only on a screen that has something to point at; the control ids come from the screen block in the prompt. */
export function guideTool(screen: VisibleScreen | null): Anthropic.Tool | null {
  if (!screen || (screen.manifest.controls.length === 0 && screen.fields.length === 0)) return null;
  return {
    name: GUIDE_TOOL_NAME,
    description:
      "Show the person, step by step, how to do something ON THIS SCREEN. Use it for every how-do-I question about the screen they are on. " +
      "Each step names one control id exactly as listed under CONTROLS (or a field id from FIELDS) and says in one short sentence what to do with it; " +
      "a step with no control is a plain instruction. The person presses the controls themselves: this tool only highlights them. Never invent an id.",
    input_schema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What the person wants to do, in a few words." },
        steps: {
          type: "array",
          maxItems: MAX_GUIDE_STEPS,
          items: {
            type: "object",
            properties: {
              control: { type: "string", description: "A control id from the screen block. Omit for a step that points at nothing." },
              text: { type: "string", description: "One short sentence." },
            },
            required: ["text"],
          },
        },
      },
      required: ["task", "steps"],
    },
  };
}

/** One step, resolved against the manifest as this caller may see it. Returns an error string for an id that is not on the screen. */
function resolveStep(control: string | undefined, text: string, screen: VisibleScreen): GuideStep | string {
  const clean = cleanText(text, 200);
  if (!control) return { text: clean };
  const id = control.trim();
  const usable = screen.manifest.controls.find((c) => c.id === id);
  if (usable) {
    return { control: usable.id, label: cleanText(usable.label, 60), text: clean, tab: usable.tab, within: usable.within, domId: usable.domId };
  }
  const blocked = screen.hidden.find((h) => h.id === id);
  if (blocked) return { control: blocked.id, label: cleanText(blocked.label, 60), text: clean, hidden: { reason: cleanText(blocked.reason, 120), alternative: blocked.alternative ? cleanText(blocked.alternative, 80) : undefined } };
  const objectType = screen.manifest.objectType;
  const field = objectType && screen.fields.find((f) => fieldControlId(objectType, f.key) === id);
  if (field) return { control: id, label: cleanText(field.label, 60), text: clean };
  return `Error: "${cleanText(id, 60)}" is not a control of this screen. Use an id listed under CONTROLS or FIELDS, or leave control out.`;
}

export type GuideOutcome = { ok: true; guide: GuideReply; result: string } | { ok: false; result: string };

/** The guide tool's input, validated against the screen. Nothing the model writes reaches the page except text and known ids. */
export function runGuide(input: unknown, screen: VisibleScreen | null): GuideOutcome {
  if (!screen) return { ok: false, result: "Error: there is no screen knowledge for this page, so no guide can be shown." };
  const raw = (input ?? {}) as { task?: unknown; steps?: unknown };
  const task = cleanText(raw.task, 120);
  if (!task) return { ok: false, result: "Error: task is required." };
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) return { ok: false, result: "Error: steps is required." };
  const steps: GuideStep[] = [];
  const errors: string[] = [];
  for (const s of raw.steps.slice(0, MAX_GUIDE_STEPS)) {
    const item = (s ?? {}) as { control?: unknown; text?: unknown };
    const text = typeof item.text === "string" ? item.text : "";
    if (!text.trim()) { errors.push("a step has no text"); continue; }
    const r = resolveStep(typeof item.control === "string" ? item.control : undefined, text, screen);
    if (typeof r === "string") errors.push(r); else steps.push(r);
  }
  if (errors.length) return { ok: false, result: errors.join(" ") };
  const hidden = steps.filter((s) => s.hidden).length;
  return {
    ok: true,
    guide: { task, steps },
    result: `Guide shown with ${steps.length} steps${hidden ? ` (${hidden} not available to this person, shown greyed with the reason)` : ""}. Reply with one short line; the steps are already on screen.`,
  };
}

/** A manifest task as a guide: the same shape the model's tool call produces, with no model involved. */
export function guideFromTask(task: Task, screen: VisibleScreen): GuideReply {
  const steps: GuideStep[] = [];
  for (const s of task.steps) {
    const r = resolveStep(s.control, s.text, screen);
    steps.push(typeof r === "string" ? { text: cleanText(s.text, 200) } : r);
  }
  return { task: cleanText(task.label, 120), steps };
}

/** The tasks offered as "show me how" chips: only ones this person can follow end to end. */
export function offeredTasks(screen: VisibleScreen | null, max = 4): { id: string; label: string }[] {
  if (!screen) return [];
  const usable = new Set(screen.manifest.controls.map((c) => c.id));
  return screen.manifest.tasks
    .filter((t) => t.steps.every((s) => !s.control || usable.has(s.control)))
    .slice(0, max)
    .map((t) => ({ id: t.id, label: cleanText(t.label, 80) }));
}
