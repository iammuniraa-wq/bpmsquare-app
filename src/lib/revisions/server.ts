import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, decryptAccount, decryptContact, encrypt } from "@/lib/encryption";
import { logChange } from "@/lib/changeLog";
import type { TenantConfig } from "@/lib/constants";
import type { Account, Contact, StandardQuote, StandardQuoteTemplate } from "@/lib/types";
import { resolveCurrency } from "@/lib/currency";
import { blockingLines, flaggedLinesOf } from "@/lib/pricing/quoteLineFlags";
import { pickEntity, readPdfDesign } from "@/lib/pdf/frameServer";
import { quoteBlocks } from "@/lib/pdf/standardQuoteFrame";
import { loadActorNames } from "@/lib/actorNames";
import { buildStandardQuoteSnapshot, diffSnapshots, readSnapshot, type SnapshotDiff, type StandardQuoteSnapshot } from "./snapshot";
import { canEditContent, isLockedByIssue, reasonProblem, revisionColumnsReady, revisionsActive, workingRevisionNo } from "./state";

// Issue and revise a Standard Quote (PDF design slice 2). Every function here takes the tenant id from the caller's session
// (requireTenantUser) and puts it on every query: the service-role client bypasses RLS, so each read and write below names the
// tenant itself (MULTI_TENANT_GUARDRAILS.md). document_revisions has no member write policy at all; this module is the only writer.

export const REVISION_OBJECT = "standard_quote";
const PENDING = "Revision history needs a database update (migration 0252)";

type Fail = { ok: false; error: string; status: number };
type DbError = { code?: string; message: string } | null;

/** 42P01 / PGRST205 (no table) and 42703 / PGRST204 (no column) both mean "migration 0252 has not run yet". */
export function isPending(error: DbError): boolean {
  return !!error && (error.code === "42P01" || error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST205" || /does not exist|schema cache/.test(error.message));
}

type Tenant = { name: string; logo_url: string | null; company_info: Record<string, unknown> | null; config: Partial<TenantConfig> | null };

async function loadTenant(admin: SupabaseClient, tenantId: string): Promise<Tenant | null> {
  const { data } = await admin.from("tenants").select("name, logo_url, company_info, config").eq("id", tenantId).maybeSingle();
  return (data as Tenant | null) ?? null;
}

/** PII in a snapshot is sealed like it is on the account and contact rows: a phone number or email is never stored in plaintext
 *  (bpmsquarecore section 7), and a revision is a copy nobody can edit later. */
function sealPii(snap: StandardQuoteSnapshot): StandardQuoteSnapshot {
  return {
    ...snap,
    account: snap.account ? { ...snap.account, phone: encrypt(snap.account.phone), email: encrypt(snap.account.email) } : null,
    contact: snap.contact ? { ...snap.contact, phone: encrypt(snap.contact.phone), email: encrypt(snap.contact.email) } : null,
  };
}
export function openPii(snap: StandardQuoteSnapshot): StandardQuoteSnapshot {
  return {
    ...snap,
    account: snap.account ? { ...snap.account, phone: decrypt(snap.account.phone), email: decrypt(snap.account.email) } : null,
    contact: snap.contact ? { ...snap.contact, phone: decrypt(snap.contact.phone), email: decrypt(snap.contact.email) } : null,
  };
}

export async function loadRevisionSnapshot(admin: SupabaseClient, tenantId: string, quoteId: string, revisionNo: number): Promise<{ snapshot: StandardQuoteSnapshot; issued_at: string } | null> {
  const { data, error } = await admin.from("document_revisions").select("snapshot, issued_at")
    .eq("tenant_id", tenantId).eq("object_type", REVISION_OBJECT).eq("object_id", quoteId).eq("revision_no", revisionNo).maybeSingle();
  if (error || !data) return null;
  const snap = readSnapshot((data as { snapshot: unknown }).snapshot);
  return snap ? { snapshot: openPii(snap), issued_at: (data as { issued_at: string }).issued_at } : null;
}

export type RevisionRow = {
  revision_no: number; issued_at: string; issued_by_name: string | null; reason: string | null; total: number; currency: string | null; diff: SnapshotDiff | null;
};

/** The history of a quotation, newest first, each with what changed since the revision before it. [] while 0252 is pending. */
export async function listRevisions(admin: SupabaseClient, tenantId: string, quoteId: string): Promise<RevisionRow[]> {
  const { data, error } = await admin.from("document_revisions").select("revision_no, issued_at, issued_by, reason, total, currency, snapshot")
    .eq("tenant_id", tenantId).eq("object_type", REVISION_OBJECT).eq("object_id", quoteId).order("revision_no", { ascending: true });
  if (error || !data) return [];
  const rows = data as { revision_no: number; issued_at: string; issued_by: string | null; reason: string | null; total: number | string; currency: string | null; snapshot: unknown }[];
  const names = await loadActorNames(admin, tenantId, rows.map((r) => r.issued_by));
  let prev: StandardQuoteSnapshot | null = null;
  const out: RevisionRow[] = rows.map((r) => {
    const snap = readSnapshot(r.snapshot);
    const diff = snap ? diffSnapshots(prev, snap) : null;
    if (snap) prev = snap;
    return { revision_no: Number(r.revision_no), issued_at: r.issued_at, issued_by_name: r.issued_by ? names.get(r.issued_by) ?? null : null, reason: r.reason, total: Number(r.total), currency: r.currency, diff };
  });
  return out.reverse();
}

type Actor = { id: string | null; email: string | null };

async function loadQuote(admin: SupabaseClient, tenantId: string, id: string) {
  const { data } = await admin.from("standard_quotes").select("*").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  return (data as StandardQuote | null) ?? null;
}

/** Issue the working copy: freeze everything printed into an immutable revision, lock the quotation. */
export async function issueStandardQuote(
  admin: SupabaseClient, session: SupabaseClient,
  args: { tenantId: string; quoteId: string; reason?: unknown; actor: Actor },
): Promise<{ ok: true; revision_no: number } | Fail> {
  const { tenantId, quoteId, actor } = args;
  const quote = await loadQuote(admin, tenantId, quoteId);
  if (!quote) return { ok: false, error: "Quote not found", status: 404 };
  if (!revisionColumnsReady(quote)) return { ok: false, error: PENDING, status: 409 };
  const tenant = await loadTenant(admin, tenantId);
  if (!tenant || !revisionsActive(tenant.config, quote)) return { ok: false, error: "Revisions are not switched on for this workspace (Settings > Company > Numbering)", status: 409 };
  if (isLockedByIssue(quote, true)) return { ok: false, error: `Rev. ${String(quote.current_revision).padStart(2, "0")} is already issued. Revise it to make changes.`, status: 409 };
  if (!canEditContent(quote, true)) return { ok: false, error: "An accepted quotation cannot be reissued. Copy it to a new quotation for a change.", status: 409 };

  const { data: lineRows } = await admin.from("standard_quote_lines").select("*").eq("standard_quote_id", quoteId).eq("tenant_id", tenantId).order("sl_no");
  const lines = (lineRows ?? []) as Record<string, unknown>[];
  if (lines.length === 0) return { ok: false, error: "Add at least one line before issuing", status: 422 };
  const blocked = blockingLines(await flaggedLinesOf(session, "standard_quote_lines", "standard_quote_id", tenantId, quoteId));
  if (blocked.length > 0) return { ok: false, error: `This quote can't be issued: ${blocked.map((b) => `line ${b.label} is below the ${b.flag.floor_pct}% margin floor (${b.flag.actual_pct}%)`).join("; ")}. Re-price it, or wait for pricing approval.`, status: 409 };

  const revisionNo = workingRevisionNo(quote);
  const reason = (typeof args.reason === "string" && args.reason.trim() ? args.reason.trim() : quote.pending_revision_reason?.trim()) || null;
  const problem = reasonProblem(revisionNo, reason);
  if (problem) return { ok: false, error: problem, status: 422 };

  const [{ data: account }, { data: contact }, { data: template }] = await Promise.all([
    admin.from("accounts").select("*").eq("id", quote.account_id).eq("tenant_id", tenantId).maybeSingle(),
    quote.contact_id ? admin.from("contacts").select("*").eq("id", quote.contact_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
    quote.template_id ? admin.from("standard_quote_templates").select("*").eq("id", quote.template_id).eq("tenant_id", tenantId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const tpl = (template as StandardQuoteTemplate | null) ?? null;
  const currency = resolveCurrency(tenant.config ?? undefined);
  const acc = account ? decryptAccount(account as Account) : null;
  const con = contact ? decryptContact(contact as Contact) : null;

  const snapshot = sealPii(buildStandardQuoteSnapshot({
    quote: quote as unknown as Record<string, unknown>, lines, account: acc as unknown as Record<string, unknown> | null, contact: con as unknown as Record<string, unknown> | null,
    template: { id: tpl?.id ?? null, name: tpl?.name ?? null, accent_color: tpl?.accent_color ?? null, logo_position: tpl?.logo_position ?? "left", blocks: quoteBlocks(tpl) },
    frame: {
      design: readPdfDesign(tenant.config), entity: pickEntity(tenant.config, quote.entity_id), company_info: (tenant.company_info ?? {}) as Record<string, string>,
      tenant_name: tenant.name, logo_url: tenant.logo_url, print_ids: acc?.print_ids ?? [],
    },
    currency: currency.code,
  }));

  const { error: insErr } = await admin.from("document_revisions").insert({
    tenant_id: tenantId, object_type: REVISION_OBJECT, object_id: quoteId, revision_no: revisionNo, issued_by: actor.id, reason: revisionNo === 0 ? (reason ?? null) : reason,
    total: Number(quote.total) || 0, currency: currency.code, snapshot,
  });
  if (insErr) {
    if (insErr.code === "23505") return { ok: false, error: "Someone issued this quotation a moment ago. Reload to see it.", status: 409 };
    if (isPending(insErr)) return { ok: false, error: PENDING, status: 409 };
    return { ok: false, error: insErr.message, status: 500 };
  }

  const { error: upErr } = await admin.from("standard_quotes")
    .update({ current_revision: revisionNo, revision_state: "issued", pending_revision_reason: null })
    .eq("id", quoteId).eq("tenant_id", tenantId);
  if (upErr) {
    // The revision row exists but the quotation could not be marked: take the row back so the two never disagree.
    await admin.from("document_revisions").delete().eq("tenant_id", tenantId).eq("object_type", REVISION_OBJECT).eq("object_id", quoteId).eq("revision_no", revisionNo);
    return { ok: false, error: isPending(upErr) ? PENDING : upErr.message, status: isPending(upErr) ? 409 : 500 };
  }

  await logChange(session, {
    tenantId, objectType: "standard_quotes", objectId: quoteId, objectLabel: quote.ref, action: "update", actorId: actor.id, actorEmail: actor.email,
    changes: [
      { field: "Revision", from: quote.current_revision == null ? "Not issued" : `Rev. ${String(quote.current_revision).padStart(2, "0")}`, to: `Rev. ${String(revisionNo).padStart(2, "0")} issued` },
      ...(reason ? [{ field: "Reason for revision", from: null, to: reason }] : []),
    ],
  });
  return { ok: true, revision_no: revisionNo };
}

/** Reopen an issued quotation as the next revision in preparation. The reason is asked now and written into the revision row when it is issued. */
export async function reviseStandardQuote(
  admin: SupabaseClient, session: SupabaseClient,
  args: { tenantId: string; quoteId: string; reason: unknown; actor: Actor },
): Promise<{ ok: true; working_revision: number } | Fail> {
  const { tenantId, quoteId, actor } = args;
  const quote = await loadQuote(admin, tenantId, quoteId);
  if (!quote) return { ok: false, error: "Quote not found", status: 404 };
  if (!revisionColumnsReady(quote)) return { ok: false, error: PENDING, status: 409 };
  const tenant = await loadTenant(admin, tenantId);
  if (!tenant || !revisionsActive(tenant.config, quote)) return { ok: false, error: "Revisions are not switched on for this workspace (Settings > Company > Numbering)", status: 409 };
  if (!isLockedByIssue(quote, true) || quote.current_revision == null) return { ok: false, error: "Only an issued quotation can be revised", status: 409 };
  if (quote.status === "accepted") return { ok: false, error: "An accepted quotation cannot be revised. Copy it to a new quotation for a change.", status: 409 };

  const next = quote.current_revision + 1;
  const problem = reasonProblem(next, args.reason);
  if (problem) return { ok: false, error: problem, status: 422 };
  const reason = String(args.reason).trim();

  const { data, error } = await admin.from("standard_quotes").update({ revision_state: "draft", pending_revision_reason: reason })
    .eq("id", quoteId).eq("tenant_id", tenantId).eq("revision_state", "issued").select("id");
  if (error) return { ok: false, error: isPending(error) ? PENDING : error.message, status: isPending(error) ? 409 : 500 };
  if (!data || data.length === 0) return { ok: false, error: "This quotation was just changed by someone else. Reload and try again.", status: 409 };

  await logChange(session, {
    tenantId, objectType: "standard_quotes", objectId: quoteId, objectLabel: quote.ref, action: "update", actorId: actor.id, actorEmail: actor.email,
    changes: [{ field: "Revision", from: `Rev. ${String(quote.current_revision).padStart(2, "0")} issued`, to: `Rev. ${String(next).padStart(2, "0")} in preparation` }, { field: "Reason for revision", from: null, to: reason }],
  });
  return { ok: true, working_revision: next };
}
