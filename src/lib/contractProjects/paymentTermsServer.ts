import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diffForLog, logChange } from "@/lib/changeLog";
import { getAuthUser } from "@/lib/supabase-server";
import { getTenant } from "@/lib/tenant";
import type { TenderDealRequest } from "@/lib/tender/dealAccess";
import { isMissingSchema } from "@/lib/tender/server";
import { choiceFrom, parseChoice, readPaymentTermTemplates, type PaymentTermsChoice } from "./paymentTerms";

// Server side of the payment-term templates (migration 0240). The workspace keeps the templates in tenants.config; the Bid tab chooses
// one for a tender (a copy is kept on opportunity_tenders.custom_data.payment_terms, so a later edit of the template never changes a bid);
// Submit bid keeps that copy with the version (tender_bid_version_terms, service role only); the project's billing schedule copies the
// terms of the winning version. Every query is tenant-scoped on the admin client and tolerates the migration being pending.

export const TERMS_KEY = "payment_terms";

export type TermsState = {
  templates: { id: string; name: string; milestones: number }[];
  chosen: PaymentTermsChoice | null;
};

export async function workspaceTemplates() {
  const tenant = await getTenant();
  return readPaymentTermTemplates(tenant?.config);
}

/** The choice saved on the tender, read from a tender row's custom_data. */
export const choiceOf = (customData: Record<string, unknown> | null | undefined): PaymentTermsChoice | null => parseChoice(customData?.[TERMS_KEY]);

const summary = (templates: { id: string; name: string; milestones: unknown[] }[]) => templates.map((t) => ({ id: t.id, name: t.name, milestones: t.milestones.length }));

export async function termsState(customData: Record<string, unknown> | null | undefined): Promise<TermsState> {
  return { templates: summary(await workspaceTemplates()), chosen: choiceOf(customData) };
}

/** Choose a template for the tender (null clears the choice). The template must be one of THIS workspace's. */
export async function chooseTemplate(req: TenderDealRequest, templateId: string | null): Promise<{ ok: true; state: TermsState } | { ok: false; status: number; error: string }> {
  const { admin, supabase, tenantId, opp, tender } = req;
  const templates = await workspaceTemplates();
  const template = templateId === null ? null : templates.find((t) => t.id === templateId) ?? null;
  if (templateId !== null && !template) return { ok: false, status: 404, error: "That payment-term template does not exist" };
  const before = choiceOf(tender.custom_data);
  const next = { ...(tender.custom_data ?? {}) } as Record<string, unknown>;
  const choice = template ? choiceFrom(template, new Date()) : null;
  if (choice) next[TERMS_KEY] = choice;
  else delete next[TERMS_KEY];
  const { error } = await admin.from("opportunity_tenders").update({ custom_data: next, updated_at: new Date().toISOString() }).eq("opportunity_id", opp.id).eq("tenant_id", tenantId);
  if (error) return { ok: false, status: 500, error: error.message };
  if ((before?.template_id ?? null) !== (template?.id ?? null)) {
    const user = await getAuthUser();
    await logChange(supabase, {
      tenantId, objectType: "opportunity_tenders", objectId: opp.id, objectLabel: `${opp.ref ?? ""} ${opp.title}`.trim(), action: "update", actorId: user?.id, actorEmail: user?.email,
      changes: diffForLog("opportunity_tenders", { payment_terms: before?.name ?? null }, { payment_terms: choice?.name ?? null }),
    });
  }
  return { ok: true, state: { templates: summary(templates), chosen: choice } };
}

/**
 * Keeps the tender's chosen terms with a bid version that just went in. Never throws: a bid is not undone because its terms could not
 * be kept (the project then falls back to the tender's choice). Called by the Submit bid route after the version row is inserted.
 */
export async function saveVersionTerms(admin: SupabaseClient, tenantId: string, opportunityId: string, versionNo: number, customData: Record<string, unknown> | null | undefined): Promise<"saved" | "none" | "pending" | "failed"> {
  const choice = choiceOf(customData);
  if (!choice) return "none";
  const { error } = await admin.from("tender_bid_version_terms").insert({ tenant_id: tenantId, opportunity_id: opportunityId, version_no: versionNo, terms: choice });
  if (!error) return "saved";
  if (isMissingSchema(error)) return "pending";
  console.error("[tender-bids] payment terms not saved", error.message);
  return "failed";
}

export type WinningTerms = { choice: PaymentTermsChoice; version_no: number | null; from: "bid_version" | "tender" };

/** The terms of the winning (last submitted) bid version; if none were kept with it, the tender's current choice. Null when neither exists. */
export async function loadWinningTerms(admin: SupabaseClient, tenantId: string, opportunityId: string): Promise<WinningTerms | null> {
  const head = await admin.from("tender_bid_versions").select("version_no").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).order("version_no", { ascending: false }).limit(1);
  const versionNo = head.error ? null : ((head.data ?? [])[0] as { version_no: number } | undefined)?.version_no ?? null;
  if (versionNo !== null) {
    const kept = await admin.from("tender_bid_version_terms").select("terms").eq("tenant_id", tenantId).eq("opportunity_id", opportunityId).eq("version_no", versionNo).maybeSingle();
    const choice = kept.error || !kept.data ? null : parseChoice((kept.data as { terms: unknown }).terms);
    if (choice) return { choice, version_no: Number(versionNo), from: "bid_version" };
  }
  const tender = await admin.from("opportunity_tenders").select("custom_data").eq("opportunity_id", opportunityId).eq("tenant_id", tenantId).maybeSingle();
  const choice = tender.error || !tender.data ? null : choiceOf((tender.data as { custom_data: Record<string, unknown> | null }).custom_data);
  return choice ? { choice, version_no: versionNo === null ? null : Number(versionNo), from: "tender" } : null;
}
