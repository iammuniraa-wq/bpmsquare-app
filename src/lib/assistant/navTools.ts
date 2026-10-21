import type Anthropic from "@anthropic-ai/sdk";
import type { NavTarget } from "./navTargets";
import type { AssistantObjectType } from "./objects";

// The forced-choice pattern for places: the schema is an enum of ids generated for THIS caller. The model can
// only pick one of them; the path comes from the server's own table, never from the model.
export function navigateTool(targets: NavTarget[]): Anthropic.Tool {
  return {
    name: "navigate",
    description:
      "Show the person a button that opens a screen (a list, a settings page, a New ... form). Use it when they ask to go somewhere or when the best answer is a place to go. " +
      "Pick ONLY an id from your NAVIGATION list. The person presses the button; you do not open anything yourself.",
    input_schema: {
      type: "object",
      properties: { target: { type: "string", enum: targets.map((t) => t.id) } },
      required: ["target"],
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
