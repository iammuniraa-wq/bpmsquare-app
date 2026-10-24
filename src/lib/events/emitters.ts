import "server-only";
import { emitEvent } from "./emit";
import { EVENTS } from "./catalog";

// One small wrapper per thing the product already does, so the routes that
// emit stay one line long and the payload shape lives in one place. Payloads
// carry references and numbers, never names, emails or phone numbers: this
// table feeds scores and webhooks.

type Actor = { actorId?: string | null };

export function emitQuoteSent(
  tenantId: string,
  p: Actor & { quoteId: string; objectType: "quote" | "standard_quote"; ref?: string | null; total?: number | null; accountId?: string | null; contactId?: string | null; redirected?: boolean },
) {
  return emitEvent(tenantId, {
    name: EVENTS.QUOTE_SENT, object_type: p.objectType, object_id: p.quoteId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    payload: { ref: p.ref ?? null, total: p.total ?? null, redirected: p.redirected === true },
  });
}

export function emitQuoteStatusChanged(
  tenantId: string,
  p: Actor & { quoteId: string; objectType: "quote" | "standard_quote"; ref?: string | null; from: string | null; to: string; accountId?: string | null; contactId?: string | null },
) {
  return emitEvent(tenantId, {
    name: EVENTS.QUOTE_STATUS_CHANGED, object_type: p.objectType, object_id: p.quoteId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    key: `${p.quoteId}:${p.from ?? "none"}->${p.to}:${new Date().toISOString().slice(0, 16)}`,
    payload: { ref: p.ref ?? null, from: p.from, to: p.to },
  });
}

/** quote.awarded / quote.rejected: the integration-middleware vocabulary for a Standard Quote that
 *  became accepted / rejected. Sits next to quote.status_changed, which is still emitted. */
export function emitQuoteOutcome(
  tenantId: string,
  p: Actor & { quoteId: string; outcome: "awarded" | "rejected"; ref?: string | null; total?: number | null; accountId?: string | null; contactId?: string | null },
) {
  return emitEvent(tenantId, {
    name: p.outcome === "awarded" ? EVENTS.QUOTE_AWARDED : EVENTS.QUOTE_REJECTED, object_type: "standard_quote", object_id: p.quoteId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    key: `${p.quoteId}:${p.outcome}:${new Date().toISOString().slice(0, 16)}`,
    payload: { ref: p.ref ?? null, total: p.total ?? null },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** quote.accepted: the customer said yes. A Standard Quote whose status became accepted, or a Quotation whose
 *  outcome became won -- whichever route set it. A Quotation's contact_id is free text, so only a real uuid is kept. */
export function emitQuoteAccepted(
  tenantId: string,
  p: Actor & { quoteId: string; objectType: "quote" | "standard_quote"; ref?: string | null; total?: number | null; accountId?: string | null; contactId?: string | null },
) {
  return emitEvent(tenantId, {
    name: EVENTS.QUOTE_ACCEPTED, object_type: p.objectType, object_id: p.quoteId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId && UUID.test(p.contactId) ? p.contactId : null,
    key: `${p.quoteId}:accepted:${new Date().toISOString().slice(0, 16)}`,
    payload: { ref: p.ref ?? null, total: p.total ?? null },
  });
}

/** quote.outcome_changed: a Quotation's result (open / won / lost / dropped) moved. */
export function emitQuoteOutcomeChanged(
  tenantId: string,
  p: Actor & { quoteId: string; ref?: string | null; from: string | null; to: string; accountId?: string | null },
) {
  return emitEvent(tenantId, {
    name: EVENTS.QUOTE_OUTCOME_CHANGED, object_type: "quote", object_id: p.quoteId, actor_id: p.actorId, account_id: p.accountId,
    key: `${p.quoteId}:${p.from ?? "none"}->${p.to}:${new Date().toISOString().slice(0, 16)}`,
    payload: { ref: p.ref ?? null, from: p.from, to: p.to },
  });
}

/** quote.created: a Standard Quote or Quotation came into being (typed, copied or converted from another object). */
export function emitQuoteCreated(
  tenantId: string,
  p: Actor & { quoteId: string; objectType: "quote" | "standard_quote"; ref?: string | null; total?: number | null; accountId?: string | null; from?: string | null },
) {
  return emitEvent(tenantId, {
    name: EVENTS.QUOTE_CREATED, object_type: p.objectType, object_id: p.quoteId, actor_id: p.actorId, account_id: p.accountId,
    key: `${p.quoteId}:created`,
    payload: { ref: p.ref ?? null, total: p.total ?? null, from: p.from ?? null },
  });
}

/** quote.revised: a Quotation got a new version. The event is about the NEW version; the old one is named in the payload. */
export function emitQuoteRevised(
  tenantId: string,
  p: Actor & { quoteId: string; ref?: string | null; revisedFrom: string; previousId: string; revision: number; accountId?: string | null },
) {
  return emitEvent(tenantId, {
    name: EVENTS.QUOTE_REVISED, object_type: "quote", object_id: p.quoteId, actor_id: p.actorId, account_id: p.accountId,
    key: `${p.quoteId}:revised`,
    payload: { ref: p.ref ?? null, revised_from: p.revisedFrom, previous_id: p.previousId, revision: p.revision },
  });
}

export function emitWorkOrderCompleted(
  tenantId: string,
  p: Actor & { workOrderId: string; ref?: string | null; from: string | null; accountId?: string | null; caseId?: string | null },
) {
  return emitEvent(tenantId, {
    name: EVENTS.WORK_ORDER_COMPLETED, object_type: "work_order", object_id: p.workOrderId, actor_id: p.actorId, account_id: p.accountId,
    key: `${p.workOrderId}:completed:${new Date().toISOString().slice(0, 16)}`,
    payload: { ref: p.ref ?? null, from: p.from, case_id: p.caseId ?? null },
  });
}

/** rfq.sent: the request went to one supplier (one event per supplier, so a reminder is not a second one). */
export function emitRfqSent(
  tenantId: string,
  p: Actor & { rfqId: string; rfqSupplierId: string; supplierId?: string | null; ref?: string | null; redirected?: boolean },
) {
  return emitEvent(tenantId, {
    name: EVENTS.RFQ_SENT, object_type: "rfq", object_id: p.rfqId, actor_id: p.actorId,
    key: `${p.rfqId}:${p.rfqSupplierId}:sent`,
    payload: { ref: p.ref ?? null, rfq_supplier_id: p.rfqSupplierId, supplier_id: p.supplierId ?? null, redirected: p.redirected === true },
  });
}

/** rfq.replied: a supplier answered (or declined). Once per supplier; a later edit of the answers is not a new reply. */
export function emitRfqReplied(
  tenantId: string,
  p: Actor & { rfqId: string; rfqSupplierId: string; source: string; declined: boolean; lines: number },
) {
  return emitEvent(tenantId, {
    name: EVENTS.RFQ_REPLIED, object_type: "rfq", object_id: p.rfqId, actor_id: p.actorId,
    key: `${p.rfqId}:${p.rfqSupplierId}:replied`,
    payload: { rfq_supplier_id: p.rfqSupplierId, source: p.source, declined: p.declined, lines: p.lines },
  });
}

/** rfq.awarded: one line was awarded to one supplier's answer (an RFQ is awarded line by line). */
export function emitRfqAwarded(
  tenantId: string,
  p: Actor & { rfqId: string; ref?: string | null; lineId: string; responseId: string; supplierId?: string | null; unitCost?: number | null },
) {
  return emitEvent(tenantId, {
    name: EVENTS.RFQ_AWARDED, object_type: "rfq", object_id: p.rfqId, actor_id: p.actorId,
    key: `${p.rfqId}:${p.lineId}:awarded:${p.responseId}`,
    payload: { ref: p.ref ?? null, line_id: p.lineId, response_id: p.responseId, supplier_id: p.supplierId ?? null, unit_cost: p.unitCost ?? null },
  });
}

export function emitOpportunityUpdated(
  tenantId: string,
  p: Actor & { opportunityId: string; ref?: string | null; fields: string[]; accountId: string; contactId?: string | null; stamp: string },
) {
  return emitEvent(tenantId, {
    name: EVENTS.OPPORTUNITY_UPDATED, object_type: "opportunity", object_id: p.opportunityId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    key: `${p.opportunityId}:updated:${p.stamp}`,
    payload: { ref: p.ref ?? null, fields: p.fields.slice(0, 20) },
  });
}

export function emitOpportunityCreated(
  tenantId: string,
  p: Actor & { opportunityId: string; ref?: string | null; stage: string; source?: string | null; accountId: string; contactId?: string | null; leadId?: string | null },
) {
  return emitEvent(tenantId, {
    name: EVENTS.OPPORTUNITY_CREATED, object_type: "opportunity", object_id: p.opportunityId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId, lead_id: p.leadId,
    key: `${p.opportunityId}:created`,
    payload: { ref: p.ref ?? null, stage: p.stage, source: p.source ?? null },
  });
}

export function emitOpportunityStageChanged(
  tenantId: string,
  p: Actor & { opportunityId: string; ref?: string | null; from: string; to: string; outcome: string; amount?: number | null; accountId: string; contactId?: string | null; stamp: string },
) {
  return emitEvent(tenantId, {
    name: EVENTS.OPPORTUNITY_STAGE_CHANGED, object_type: "opportunity", object_id: p.opportunityId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    key: `${p.opportunityId}:${p.from}->${p.to}:${p.stamp}`,
    payload: { ref: p.ref ?? null, from: p.from, to: p.to, outcome: p.outcome, amount: p.amount ?? null },
  });
}

export function emitOpportunityClosed(
  tenantId: string,
  p: Actor & { opportunityId: string; ref?: string | null; outcome: string; amount?: number | null; accountId: string; contactId?: string | null; stamp: string },
) {
  return emitEvent(tenantId, {
    name: EVENTS.OPPORTUNITY_CLOSED, object_type: "opportunity", object_id: p.opportunityId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    key: `${p.opportunityId}:closed:${p.stamp}`,
    payload: { ref: p.ref ?? null, outcome: p.outcome, amount: p.amount ?? null },
  });
}

export function emitCaseCreated(tenantId: string, p: Actor & { caseId: string; ref?: string | null; type?: string | null; accountId: string }) {
  return emitEvent(tenantId, {
    name: EVENTS.CASE_CREATED, object_type: "case", object_id: p.caseId, actor_id: p.actorId, account_id: p.accountId,
    key: `${p.caseId}:created`,
    payload: { ref: p.ref ?? null, type: p.type ?? null },
  });
}

export function emitCaseStatusChanged(
  tenantId: string,
  p: Actor & { caseId: string; ref?: string | null; from: string | null; to: string; accountId?: string | null },
) {
  return emitEvent(tenantId, {
    name: EVENTS.CASE_STATUS_CHANGED, object_type: "case", object_id: p.caseId, actor_id: p.actorId, account_id: p.accountId,
    key: `${p.caseId}:${p.from ?? "none"}->${p.to}:${new Date().toISOString().slice(0, 16)}`,
    payload: { ref: p.ref ?? null, from: p.from, to: p.to },
  });
}

export function emitCaseClosed(tenantId: string, p: Actor & { caseId: string; ref?: string | null; status: string; accountId?: string | null }) {
  return emitEvent(tenantId, {
    name: EVENTS.CASE_CLOSED, object_type: "case", object_id: p.caseId, actor_id: p.actorId, account_id: p.accountId,
    key: `${p.caseId}:closed:${new Date().toISOString().slice(0, 16)}`,
    payload: { ref: p.ref ?? null, status: p.status },
  });
}

export function emitInvoiceSent(tenantId: string, p: Actor & { invoiceId: string; ref?: string | null; total?: number | null; accountId: string; contactId?: string | null }) {
  return emitEvent(tenantId, {
    name: EVENTS.INVOICE_SENT, object_type: "invoice", object_id: p.invoiceId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    key: `${p.invoiceId}:sent`,
    payload: { ref: p.ref ?? null, total: p.total ?? null },
  });
}

export function emitInvoicePaid(tenantId: string, p: Actor & { invoiceId: string; ref?: string | null; total?: number | null; accountId: string; contactId?: string | null }) {
  return emitEvent(tenantId, {
    name: EVENTS.INVOICE_PAID, object_type: "invoice", object_id: p.invoiceId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    key: `${p.invoiceId}:paid`,
    payload: { ref: p.ref ?? null, total: p.total ?? null },
  });
}

export function emitInvoiceOverdue(tenantId: string, p: { invoiceId: string; ref?: string | null; dueDate: string; outstanding?: number | null; accountId: string; contactId?: string | null }) {
  return emitEvent(tenantId, {
    name: EVENTS.INVOICE_OVERDUE, object_type: "invoice", object_id: p.invoiceId, source: "runner",
    account_id: p.accountId, contact_id: p.contactId,
    // Once per invoice per due date: a rescheduled due date can go overdue again.
    key: `${p.invoiceId}:overdue:${p.dueDate}`,
    payload: { ref: p.ref ?? null, due_date: p.dueDate, outstanding: p.outstanding ?? null },
  });
}

export function emitCampaignSent(
  tenantId: string,
  p: Actor & { campaignId: string; name?: string | null; sent: number; failed: number; skipped: number },
) {
  return emitEvent(tenantId, {
    name: EVENTS.CAMPAIGN_SENT, object_type: "marketing_campaign", object_id: p.campaignId, actor_id: p.actorId,
    campaign_id: p.campaignId,
    key: `${p.campaignId}:sent`,
    payload: { name: p.name ?? null, sent: p.sent, failed: p.failed, skipped: p.skipped },
  });
}

type OrderCtx = Actor & { orderId: string; ref?: string | null; total?: number | null; accountId?: string | null; contactId?: string | null };

export function emitOrderCreated(tenantId: string, p: OrderCtx & { sourceType?: string | null; sourceId?: string | null; typeId?: string | null }) {
  return emitEvent(tenantId, {
    name: EVENTS.ORDER_CREATED, object_type: "sales_order", object_id: p.orderId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    key: `${p.orderId}:created`,
    payload: { ref: p.ref ?? null, total: p.total ?? null, source_type: p.sourceType ?? null, source_id: p.sourceId ?? null, type_id: p.typeId ?? null },
  });
}

export function emitOrderConfirmed(tenantId: string, p: OrderCtx) {
  return emitEvent(tenantId, {
    name: EVENTS.ORDER_CONFIRMED, object_type: "sales_order", object_id: p.orderId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    // A reopened order can be confirmed again, so the minute is part of the key.
    key: `${p.orderId}:confirmed:${new Date().toISOString().slice(0, 16)}`,
    payload: { ref: p.ref ?? null, total: p.total ?? null },
  });
}

export function emitOrderCancelled(tenantId: string, p: OrderCtx & { reason?: string | null }) {
  return emitEvent(tenantId, {
    name: EVENTS.ORDER_CANCELLED, object_type: "sales_order", object_id: p.orderId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    key: `${p.orderId}:cancelled`,
    // The reason is free text a person typed: it stays in the change history, not in the event.
    payload: { ref: p.ref ?? null, total: p.total ?? null, has_reason: !!p.reason },
  });
}

export function emitOrderSent(tenantId: string, p: OrderCtx & { redirected?: boolean }) {
  return emitEvent(tenantId, {
    name: EVENTS.ORDER_SENT, object_type: "sales_order", object_id: p.orderId, actor_id: p.actorId,
    account_id: p.accountId, contact_id: p.contactId,
    payload: { ref: p.ref ?? null, total: p.total ?? null, redirected: p.redirected === true },

// ── Shared Inbox (0214) ─────────────────────────────────────────────────────────────────────────────────────────────
// Payloads are ids and counts only. A sender's address, a subject and the mail itself never go into this table: it feeds
// scores and webhooks, and mail is private correspondence.

/** email.received: a customer's message landed in a channel. Once per stored message (a provider retry is a no-op). */
export function emitEmailReceived(
  tenantId: string,
  p: { emailId: string; channelId: string; attachments: number; replyInThread: boolean },
) {
  return emitEvent(tenantId, {
    name: EVENTS.EMAIL_RECEIVED, object_type: "inbound_emails", object_id: p.emailId, source: "provider_webhook",
    key: `${p.emailId}:received`,
    payload: { channel_id: p.channelId, attachments: p.attachments, reply_in_thread: p.replyInThread },
  });
}

/** email.handled: someone marked a message handled (or spam), or converted it. */
export function emitEmailHandled(
  tenantId: string,
  p: Actor & { emailId: string; channelId: string; status: "handled" | "spam"; via: "manual" | "conversion" },
) {
  return emitEvent(tenantId, {
    name: EVENTS.EMAIL_HANDLED, object_type: "inbound_emails", object_id: p.emailId, actor_id: p.actorId,
    key: `${p.emailId}:${p.status}:${new Date().toISOString().slice(0, 16)}`,
    payload: { channel_id: p.channelId, status: p.status, via: p.via },
  });
}

/** email.converted: a message became a Quote, Project, Case, Lead or Estimate. */
export function emitEmailConverted(
  tenantId: string,
  p: Actor & { emailId: string; channelId: string; objectType: string; objectId: string; accountId?: string | null; attachments: number },
) {
  return emitEvent(tenantId, {
    name: EVENTS.EMAIL_CONVERTED, object_type: "inbound_emails", object_id: p.emailId, actor_id: p.actorId, account_id: p.accountId,
    key: `${p.emailId}:converted:${p.objectType}:${p.objectId}`,
    payload: { channel_id: p.channelId, to_object_type: p.objectType, to_object_id: p.objectId, attachments: p.attachments },
  });
}
