import { cleanText } from "./screens/filter";

// Anything typed by a person (a record's title or notes, a custom field's label) that is put between wrapper tags in
// the prompt goes through one of these, so it cannot close the wrapper or start a line that reads like a rule
// (audit 2026-10-22 L6). Fixed text written in code does not need them.

/** One short line of plain text: no angle brackets, backticks, control characters or line breaks. */
export const promptText = (s: unknown, max = 160): string => cleanText(s, max);

const TAG_OR_SEPARATOR = new RegExp("[<>" + String.fromCharCode(0x2028, 0x2029) + "]", "g");

/** JSON for a prompt block: the same data, with every character that could open or close a tag written as an escape. */
export function promptJson(value: unknown): string {
  return JSON.stringify(value).replace(TAG_OR_SEPARATOR, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}
