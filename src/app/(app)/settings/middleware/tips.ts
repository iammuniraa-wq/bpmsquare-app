// The explanations the Integration middleware page keeps behind an "i"
// (bpmsquarecore 6b, docs/design/ux-simplification.md). One place, so a test
// holds every text to the InfoTip limit (two sentences, 160 characters). The
// screen never prints these as running text.

export const MIDDLEWARE_TIPS = {
  page: "Everything about syncing with your ERP is here. Pick a connector, then work through the tabs from left to right.",
  switcher: "One chip per connector. Every connector gets the same five tabs.",
  setup: "Five checks from connected to your first real quote. Each opens the tab where it is done.",

  // Connections
  connection: "Where BPMSquare signs in to your ERP. The secret is stored encrypted and is never shown again.",
  product: "Which ERP product you run. It decides what an awarded quote becomes there.",
  loginType: "How BPMSquare proves who it is. An app registration with a client secret is the usual choice.",
  directory: "The directory (tenant) ID of the Microsoft account that owns the app registration.",
  clientId: "The application (client) ID of the app registration that signs in for BPMSquare.",
  secret: "Paste it once. After saving it shows as Stored and cannot be read back; leave it blank to keep it.",
  secretExpiry: "The day the secret stops working. BPMSquare warns you 30 days before.",
  company: "The company or legal entity inside the ERP that records are written to.",
  certificate: "The certificate and its private key. The key never leaves the server and is not shown again.",
  priceList: "The ERP needs a price list on every quote. Pick the one your quotes use.",
  currency: "The currency your quotes are made in. It must match the price list.",
  permissions: "Tries the reads and looks up the create and close rights. Nothing is created.",
  schema: "The tables this page needs in your database. If one is missing, run the named SQL file once.",
  otherLanes: "Other ways data moves in and out of BPMSquare. Each one has its own page.",

  // What goes out
  awarded: "A Standard Quote marked accepted goes to the ERP. Automatic sends at once; manual waits for you.",
  rejected: "A Standard Quote marked rejected is closed in the ERP where that makes sense. Some products send nothing.",
  mode: "Automatic sends the moment the status changes. Manual waits until you press Send now.",
  fence: "Which fence project data leaves with the quote. It applies only to quotes made from a fence project.",
  estimate: "What leaves with a quote made from an estimate. Internal costs are never customer-facing, so they start off.",
  checkQuote: "Pick an awarded or rejected quote to see what would be sent, or send it now. Send now is safe to repeat; a quote never lands twice.",
  testQuote: "Sends a clearly named sample quote starting with ZZ, so you can see it arrive. The product never deletes it.",

  // Mapping
  mapping: "Works without any change. Edit only if your ERP is customised.",
  standardMap: "The standard mapping for your ERP product. Edit to change it; Reset to standard brings it back.",
  editTools: "Suggest mapping matches your fields to the ERP's by name, for you to review. Refresh fields reads the ERP's list again.",
  templateValue: "Type text and add fields from the list, like {ref} and {description}. A field with no value is left out.",
  required: "The ERP refuses a record without these. Map them, or the send fails.",
  inbound: "How ERP columns fill BPMSquare fields when records are pulled in. Preview shows real rows first.",
  inboundOn: "Includes this entity when you sync. Switch it off to leave it out.",

  // Monitor
  monitor: "Every message in and out, newest first. Open one for its details.",
  body: "Shown only when you ask, and each look is written to the change history.",
  rowDetails: "Error text and, for admins, the message body. Each look is written to the change history.",
  capture: "Keeps the request and the answer for 30 days with personal data and tokens removed. Off unless you switch it on.",

  // Resync
  failed: "Items that did not reach the ERP. Retry is safe to repeat; nothing is sent twice.",
  sendRecord: "Pick a record and send it now. A Standard Quote follows its awarded or rejected rule.",
  syncNow: "Reads what changed in the ERP since the last run. Full resync reads everything again.",
  schedule: "How often BPMSquare reads this from the ERP by itself. Daily runs at 02:00 UTC.",
  history: "The latest runs, newest first, with what each one read, created, updated and could not do.",
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
