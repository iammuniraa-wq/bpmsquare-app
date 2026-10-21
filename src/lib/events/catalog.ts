// The event catalogue: the only place an event name is spelled. Names are
// "<object>.<verb>". The Sales Engine names (docs/sales-engine-architecture.md
// section 5.1) and the Newsletter Studio email.* names (docs/newsletter-studio-
// architecture.md section 12.1) are adopted verbatim; the marketing rows are
// from docs/marketing-platform-architecture.md section 1.2. Adding an event
// means adding it here first -- emitEvent() refuses names that are not listed.

export const EVENTS = {
  // Sales
  OPPORTUNITY_CREATED: "opportunity.created",
  OPPORTUNITY_STAGE_CHANGED: "opportunity.stage_changed",
  OPPORTUNITY_UPDATED: "opportunity.updated",
  OPPORTUNITY_CLOSED: "opportunity.closed",
  QUOTE_CREATED: "quote.created",
  QUOTE_UPDATED: "quote.updated",
  QUOTE_PRICED: "quote.priced",
  QUOTE_SENT: "quote.sent",
  QUOTE_REVISED: "quote.revised",
  QUOTE_STATUS_CHANGED: "quote.status_changed",
  QUOTE_OUTCOME_CHANGED: "quote.outcome_changed",
  QUOTE_OPENED: "quote.opened",
  QUOTE_ACCEPTED: "quote.accepted",
  QUOTE_CHANGE_REQUESTED: "quote.change_requested",
  // Pricing / RFQ
  PRICING_VERSION_PUBLISHED: "pricing.version_published",
  PRICING_RFQ_REPLIED: "pricing.rfq_replied",
  RFQ_SENT: "rfq.sent",
  RFQ_REPLIED: "rfq.replied",
  RFQ_AWARDED: "rfq.awarded",
  // Service
  CASE_CREATED: "case.created",
  CASE_STATUS_CHANGED: "case.status_changed",
  CASE_CLOSED: "case.closed",
  CONTRACT_EXPIRING: "contract.expiring",
  CONTRACT_RENEWED: "contract.renewed",
  WORK_ORDER_COMPLETED: "work_order.completed",
  // Finance
  INVOICE_SENT: "invoice.sent",
  INVOICE_PAID: "invoice.paid",
  INVOICE_OVERDUE: "invoice.overdue",
  // Newsletter Studio (names fixed by that design)
  NEWSLETTER_CREATED: "newsletter.created",
  NEWSLETTER_UPDATED: "newsletter.updated",
  NEWSLETTER_ARCHIVED: "newsletter.archived",
  NEWSLETTER_LANGUAGE_READY: "newsletter.language_ready",
  NEWSLETTER_VERSION_CREATED: "newsletter.version_created",
  // Email (names fixed by the Studio)
  EMAIL_SENT: "email.sent",
  EMAIL_FAILED: "email.failed",
  EMAIL_SKIPPED: "email.skipped",
  EMAIL_DELIVERED: "email.delivered",
  EMAIL_BOUNCED: "email.bounced",
  EMAIL_COMPLAINED: "email.complained",
  EMAIL_OPENED: "email.opened",
  EMAIL_CLICKED: "email.clicked",
  EMAIL_INTEREST: "email.interest",
  EMAIL_UNSUBSCRIBED: "email.unsubscribed",
  // Forms / web
  FORM_SUBMITTED: "form.submitted",
  WEB_PAGE_VIEWED: "web.page_viewed",
  WEB_IDENTIFIED: "web.identified",
  // WhatsApp (later)
  WHATSAPP_SENT: "whatsapp.sent",
  WHATSAPP_FAILED: "whatsapp.failed",
  WHATSAPP_DELIVERED: "whatsapp.delivered",
  WHATSAPP_READ: "whatsapp.read",
  WHATSAPP_REPLIED: "whatsapp.replied",
  WHATSAPP_OPTED_OUT: "whatsapp.opted_out",
  // Marketing objects
  CAMPAIGN_SENT: "campaign.sent",
  LEAD_CREATED: "lead.created",
  LEAD_SCORED: "lead.scored",
  LEAD_STAGE_CHANGED: "lead.stage_changed",
  LEAD_ASSIGNED: "lead.assigned",
  LEAD_SLA_BREACHED: "lead.sla_breached",
  JOURNEY_ENTERED: "journey.entered",
  JOURNEY_EXITED: "journey.exited",
  CONSENT_GRANTED: "consent.granted",
  CONSENT_WITHDRAWN: "consent.withdrawn",
  CONSENT_CONFIRMED: "consent.confirmed",
  EVENT_REGISTERED: "event.registered",
  EVENT_ATTENDED: "event.attended",
  EVENT_NO_SHOW: "event.no_show",
  // Signals (sibling design)
  SIGNAL_DETECTED: "signal.detected",
  ACCOUNT_BUYING_STAGE_CHANGED: "account.buying_stage_changed",
  // ABM (docs/abm-architecture.md section 8). Payloads carry ids and short codes, never names.
  ABM_PROGRAM_CREATED: "abm.program.created",
  ABM_PROGRAM_UPDATED: "abm.program.updated",
  ABM_TARGET_ADDED: "abm.target.added",
  ABM_TARGET_REMOVED: "abm.target.removed",
  ABM_TARGET_PROGRESS_CHANGED: "abm.target.progress_changed",
  ABM_TARGET_TIER_CHANGED: "abm.target.tier_changed",
  ABM_TARGET_OWNER_CHANGED: "abm.target.owner_changed",
  ABM_TARGET_NEXT_STEP_SET: "abm.target.next_step_set",
  ABM_MEMBER_ADDED: "abm.buying_group.member_added",
  ABM_MEMBER_REMOVED: "abm.buying_group.member_removed",
  ABM_MEMBER_ROLE_CHANGED: "abm.buying_group.role_changed",
  // WFM (planned; no marketing use)
  WFM_LEAVE_REQUESTED: "wfm.leave_requested",
  WFM_OT_REQUESTED: "wfm.ot_requested",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

const NAMES: ReadonlySet<string> = new Set(Object.values(EVENTS));

export function isKnownEvent(name: string): name is EventName {
  return NAMES.has(name);
}

export const EVENT_SOURCES = ["app", "public_link", "tracker", "provider_webhook", "runner", "api"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** Consumers ignore events deeper than this (loop guard, Sales Engine 5.2). */
export const MAX_EVENT_DEPTH = 2;
