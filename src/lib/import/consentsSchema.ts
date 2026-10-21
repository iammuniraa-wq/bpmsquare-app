import type { ObjectSpec } from "./types";

// Consents as a Data Workbench object: IMPORT brings a spreadsheet of opt-ins (and
// withdrawals) into the consent ledger, EXPORT lists the current answers read-only.
// There is deliberately no Update: the ledger is append-only history, so an answer is
// changed by importing (or recording) a NEW answer, never by editing an old one.
//
// Fixed shape, never tenant-customizable, so a static spec. Not on the REST API or MCP
// in this phase (the marketing roadmap puts consents there in M9).
export const CONSENTS_SPEC: ObjectSpec = {
  id: "consents",
  label: "Consents",
  icon: "✓",
  description: "Opt-ins and withdrawals for marketing. Import a sheet of who agreed to hear from you, with how they agreed; export shows each person's current answer. Matched to existing contacts by email — a row never creates a contact, and old answers are never edited.",
  dependsOn: ["contacts"],
  fields: [
    { key: "email", label: "Email", type: "email", required: true, hint: "The contact's email address — they must already be a contact in this workspace", aliases: ["email address", "e-mail", "mail", "contact email"] },
    { key: "channel", label: "Channel", type: "enum", options: ["email", "whatsapp", "sms", "phone"], hint: "Where they agreed to be contacted — blank means email", aliases: ["medium", "channel type"] },
    { key: "topic", label: "Consent topic", type: "text", hint: "One of your workspace's consent topics (by name) — blank means every consent topic", aliases: ["topic", "consent topic", "topics", "subject", "interest", "list"] },
    { key: "status", label: "Answer", type: "enum", required: true, options: ["granted", "withdrawn"], hint: "Type granted (shown as Agreed: they said yes) or withdrawn (shown as Withdrawn: they asked to stop)", aliases: ["status", "consent", "opt in", "optin", "opted in", "answer"] },
    { key: "basis", label: "Basis", type: "enum", options: ["consent", "existing_customer"], hint: "Required for every granted row. Type consent (shown as They agreed) or existing_customer (shown as Existing customer, only where your country and settings allow it)", aliases: ["legal basis", "lawful basis", "consent basis"] },
    { key: "given_on", label: "Date they agreed", type: "date", hint: "When they originally agreed, if the sheet says — kept as evidence", aliases: ["date", "consent date", "agreed on", "opt in date", "date given"] },
    { key: "note", label: "Note", type: "text", hint: "How it was obtained, if the sheet says (for example: web form, trade show card)", aliases: ["notes", "source note", "evidence", "how obtained", "remark"] },
    // Export-only: the current state, as the ledger holds it. Never importable.
    { key: "contact_id", label: "Contact ID (record)", type: "text", exportOnly: true, hint: "The contact's internal record id" },
    { key: "contact_name", label: "Contact", type: "text", exportOnly: true, hint: "The contact's name" },
    { key: "account_name", label: "Account", type: "text", exportOnly: true, hint: "The contact's account" },
    { key: "since", label: "Since", type: "date", exportOnly: true, hint: "When this answer was recorded" },
    { key: "jurisdiction", label: "Jurisdiction", type: "text", exportOnly: true, hint: "The country rule that applied when it was recorded" },
  ],
  sampleRows: [
    { email: "buyer@example.com", channel: "email", topic: "Offers", status: "granted", basis: "consent", given_on: "2026-09-12", note: "Trade show card" },
    { email: "former@example.com", channel: "email", topic: "", status: "withdrawn", note: "Asked by phone to stop" },
  ],
};
