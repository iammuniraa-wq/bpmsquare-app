// The explanations the Webhooks page keeps behind an "i" (bpmsquarecore 6b, docs/design/ux-simplification.md).
// One place, so a test holds every text to the InfoTip limit (two sentences, 160 characters). The screen never
// prints these as running text.

export const WEBHOOK_TIPS = {
  page: "Every address BPMSquare calls is made and kept here. An Event webhook sends changes as they happen; a Call webhook sends one record when something fires it.",
  kind: "Event sends every change to the objects you pick; Call sends one record when something fires it, such as an awarded quote. It cannot change later.",
  objectType: "The one kind of record this webhook sends. It decides which tokens you can use, and it cannot change later.",
  events: "Pick the objects whose changes are sent. All objects sends every change.",
  active: "Switch off to stop calls without losing the set-up. A webhook that failed too often pauses itself; Resume starts it again.",
  button: "Adds a Send to this webhook entry to the menu on every account page.",
  url: "The https address to call. You can put tokens in the path or query, but never personal data.",
  method: "How the call is made. GET sends no body; POST, PUT and PATCH send the payload.",
  headers: "Extra headers your receiver expects, such as an API key. After saving a value is hidden and can only be replaced.",
  payload: "Standard sends a signed record in a fixed shape. Template lets you write your own JSON with tokens.",
  template: "Valid JSON where each token sits inside quotes. A token that is the whole value keeps its type, so a list stays a list.",
  tokens: "Pick a token to put it where your cursor is. It is replaced with the record's value when the call is made.",
  personalData: "Off by default. Switch on only if the receiver needs email, phone or tax numbers; they are sent as they are stored.",
  timeout: "How long to wait for an answer before the call counts as failed. A failed call is tried once more after 2 seconds.",
  secret: "BPMSquare signs every call with this secret so your receiver can check it came from us. It is shown once and cannot be read back.",
  regenerate: "The old secret stops verifying at once. Update the receiving end straight away.",
  headersSent: "These headers are added to every call. Your own headers cannot replace them.",
  test: "Pick a real record and send it. The call, its answer and any failure show here and in the Monitor.",
  preview: "Shows the exact request without sending anything.",
  log: "The last 20 calls. The Monitor keeps their details for 2 days and lets you restart a failed one.",
  usedBy: "Where this webhook is chosen: a Links row, a Coverage route or a record button. A webhook that is in use cannot be deleted.",
} as const;

export type WebhookTipKey = keyof typeof WEBHOOK_TIPS;

/** The tip on a Call webhook's kind line depends on the kind, so it is built here and held to the same limit. */
export function kindTip(kind: "event" | "call"): string {
  return kind === "event"
    ? "Sends every change to the objects you picked, signed, as it happens. It cannot be turned into a Call."
    : "Sends one record when something fires it: an awarded quote, a button or a coverage rule. It cannot be turned into an Event.";
}
