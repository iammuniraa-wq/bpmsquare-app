// The explanations the Integration middleware page keeps behind an "i"
// (bpmsquarecore 6b, docs/design/ux-simplification.md). One place, so a test
// holds every text to the InfoTip limit (two sentences, 160 characters). The
// screen never prints these as running text.

export const MIDDLEWARE_TIPS = {
  page: "Everything about syncing with your ERP is here. Pick a connector, then work through the tabs from left to right.",
  switcher: "One chip per connector; the dot shows its state. Click the open one to see or change the connection.",
  setup: "Five checks from connected to your first real quote. The line opens the next one.",

  // The connection (behind the connector chip)
  product: "Which ERP product you run. It decides what an awarded quote becomes there.",
  loginType: "How BPMSquare proves who it is. An app registration with a client secret is the usual choice.",
  directory: "The directory (tenant) ID of the Microsoft account that owns the app registration.",
  clientId: "The application (client) ID of the app registration that signs in for BPMSquare.",
  secret: "Paste it once. After saving it shows as Stored and cannot be read back; leave it blank to keep it.",
  secretExpiry: "The day the secret stops working. BPMSquare warns you 30 days before.",
  company: "The company or legal entity inside the ERP that records are written to.",
  certificate: "The certificate and its private key. The key never leaves the server and is not shown again.",

  // Links
  links: "Each row links a BPMSquare object with one in your ERP. A quote goes to the ERP when it is awarded; a rejected quote never leaves.",
  createAs: "What the quote becomes in your ERP. A choice that is greyed out is not ready for your ERP yet.",
  whichWebhook: "The webhook from Settings > Webhooks that receives the quote when it is awarded. It is sent once, like any other link.",
  include: "What travels with the quote. A greyed item cannot be sent to the chosen target.",
  fallbackPriceList: "A quote uses the customer's own price list in Dynamics. This one is used only when the customer has none.",
  tryIt: "Preview shows what would be sent without sending anything. Send a quote now is safe to repeat; a quote never lands twice.",

  // Mapping
  mapping: "Left is the BPMSquare field, right is the ERP field it fills. Works without any change; edit only if your ERP is customised.",

  // Monitor
  monitor: "Every message in and out, newest first. Tick lines to restart them; open a line for its details.",
  restart: "Sends the ticked lines again. It is safe to repeat; nothing lands twice in the ERP.",
  rowDetails: "Error text and, for admins, more about the line. Each look is written to the change history.",
  capture: "Keeps the request and the answer of inbound pulls and API calls for 2 days, with personal data and tokens removed. Off unless you switch it on.",

  // Resync
  resync: "Moves data from the ERP into BPMSquare on demand. Messages and failures are in the Monitor.",
  schedule: "How often BPMSquare reads this from the ERP by itself. Daily runs at 02:00 UTC.",
  filters: "A full resync reads only the records that match. Sync now ignores these and reads what changed.",
  sinceDate: "Only records changed in the ERP on or after this day.",
  containsText: "Matches part of a record's name or number. Entities without a name or number cannot use it.",
  activeOnly: "Leaves out records marked inactive. Available for Dataverse only.",
  getRecords: "Reads only the records you list, by their ERP id or number. Nothing else is read, and Sync now is not affected.",
  recordIds: "Up to 100, separated by commas, spaces or new lines. An id is the long code of a record; a number is the one people see.",
  sendRecord: "Pick a record and send it now. A Standard Quote follows its awarded or rejected rule.",
} as const;

export type TipKey = keyof typeof MIDDLEWARE_TIPS;

/** The environment address hint depends on the product, so it is built here and held to the same limit. */
export function environmentTip(product: string, authMode: string): string {
  if (product === "bc") return authMode === "basic" ? "The API base address of your on-premises server." : "The name of the environment in Business Central, such as Production.";
  if (product === "fo") return "The web address of your environment, such as https://contoso.operations.dynamics.com.";
  return "The web address of your environment, such as https://contoso.crm4.dynamics.com.";
}

export function secretExpiryTip(daysLeft: number | null): string {
  if (daysLeft === null) return MIDDLEWARE_TIPS.secretExpiry;
  return daysLeft < 0 ? "The secret has stopped working. Make a new one in Microsoft Entra and paste it here." : `The secret stops working in ${daysLeft} day${daysLeft === 1 ? "" : "s"}. Make a new one in Microsoft Entra before then.`;
}
