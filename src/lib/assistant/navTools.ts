import type Anthropic from "@anthropic-ai/sdk";
import { NAV_NONE } from "./navGuard";
import type { NavTarget } from "./navTargets";
import type { AssistantObjectType } from "./objects";

// The pick is an enum of ids generated for THIS caller, plus an explicit way to decline: a required choice with no
// "none" forces the model to substitute the nearest screen when the one asked for is not in the list. The path comes
// from the server's own table, never from the model, and the server checks the pick against the person's words
// (navGuard.judgeNavigation) before any button is shown.
export function navigateTool(targets: NavTarget[]): Anthropic.Tool {
  return {
    name: "navigate",
    description:
      "Show the person a button that opens a screen (a list, a settings page, a New ... form). Use it when they ask to go somewhere or when the best answer is a place to go. " +
      "Pick ONLY an id from your NAVIGATION list. The person presses the button; you do not open anything yourself. " +
      `If the screen they named is not in the list, pick "${NAV_NONE}": never pick a different screen as a substitute. ` +
      "Always set asked_for to the screen as the person named it.",
    input_schema: {
      type: "object",
      properties: {
        asked_for: { type: "string", description: "The screen as the person named or described it, in their words (for example: data workbench)." },
        target: { type: "string", enum: [...targets.map((t) => t.id), NAV_NONE] },
      },
      required: ["asked_for", "target"],
    },
  };
}

export function openRecordTool(types: AssistantObjectType[]): Anthropic.Tool {
  return {
    name: "open_record",
    description:
      "Find ONE record by its reference or name and show a button that opens it (\"open quote SQ-2026-0012\", \"take me to the Al-Otaibi account\"). " +
      "If several match, the result lists them: ask the person which one.",
    input_schema: {
      type: "object",
      properties: { object: { type: "string", enum: types }, query: { type: "string", description: "The reference or name, as the person wrote it." } },
      required: ["object", "query"],
    },
  };
}
