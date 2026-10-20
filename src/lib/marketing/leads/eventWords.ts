// What an event says, in the words a salesperson would use. Pure and
// client-safe. The timeline on a lead record is built from these; an event
// the table does not know is shown by its raw name rather than hidden, so
// nothing a person did is ever silently dropped from the story.

const WORDS: Record<string, string> = {
  "email.sent": "We emailed them",
  "email.delivered": "Our email arrived",
  "email.opened": "Opened an email",
  "email.clicked": "Clicked a link in an email",
  "email.interest": "Said they are interested",
  "email.unsubscribed": "Unsubscribed from our emails",
  "email.bounced": "Their email address bounced",
  "email.complained": "Marked our email as spam",
  "quote.sent": "We sent them a quote",
  "quote.opened": "Opened a quote",
  "quote.accepted": "Accepted a quote",
  "quote.change_requested": "Asked for a change to a quote",
  "form.submitted": "Filled in a form",
  "web.page_viewed": "Looked at a page on the website",
  "web.identified": "Was recognised on the website",
  "whatsapp.replied": "Replied on WhatsApp",
  "event.attended": "Came to an event",
  "event.registered": "Signed up for an event",
  "case.created": "Opened a support case",
  "invoice.paid": "Paid an invoice",
  "consent.granted": "Agreed to hear from us",
  "consent.withdrawn": "Withdrew their consent",
  "lead.scored": "Score updated",
  "lead.stage_changed": "Stage changed",
  "lead.assigned": "Handed to a salesperson",
  "lead.sla_breached": "Response time passed",
  "lead.created": "Became a lead",
};

export function eventWords(name: string): string {
  return WORDS[name] ?? name;
}

/** A short extra clause from a payload, only from keys we know are safe ids, numbers or labels. */
export function eventDetail(name: string, payload: Record<string, unknown> | null | undefined): string | null {
  const p = payload ?? {};
  if (name === "lead.stage_changed" && typeof p.from === "string" && typeof p.to === "string") return `${p.from} to ${p.to}`;
  if (name === "lead.scored" && typeof p.score === "number") return `now ${p.score}`;
  if (name === "email.clicked" && typeof p.label === "string") return p.label.slice(0, 80);
  if (name === "web.page_viewed" && typeof p.path === "string") return p.path.slice(0, 80);
  return null;
}
