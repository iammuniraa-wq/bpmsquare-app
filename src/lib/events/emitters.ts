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
