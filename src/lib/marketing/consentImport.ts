import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChangeLogEntryParams } from "@/lib/changeLog";
import type { TenantConfig } from "@/lib/constants";
import type { RowOutcome } from "@/lib/import/types";
import { consentDefaultsOf, topicsOf } from "./config";
import { recordConsentBatch, type ConsentBatchEntry } from "./consentWrite";
import { jurisdictionForCountry } from "./jurisdictions";
import { contactsMatchingEmails } from "./recipientLookup";
import { checkImportBasis, cleanNote, STAFF_CHANNELS, type StaffConsentContext } from "./staffConsent";

// Data Workbench -> Consents -> Import: the migration path from a spreadsheet of opt-ins.
//
//  * APPEND-ONLY. Every row becomes a new consent_events row; nothing is edited or removed.
//  * Each row says who (an email address), what (channel, topic), the answer, and the BASIS
//    (required for an opt-in). The source is always "import" and the FILE NAME is stored as
//    evidence, so every answer can be traced back to the sheet it came from.
//  * People are found by email through the blind index, within this tenant. A row whose address
//    is nobody's contact is REPORTED and skipped -- an import never creates a contact. An address
//    shared by several contacts is refused rather than guessed at.
//  * The same jurisdiction limits as a person recording by hand apply to the basis.

export const MAX_CONSENT_IMPORT_ROWS = 2000;
export const MAX_FILE_NAME = 200;

export type ConsentImportRow = { rowNum: number; values: Record<string, string> };
export type ConsentImportResult = { outcomes: RowOutcome[]; changeLog: Omit<ChangeLogEntryParams, "actorId" | "actorEmail">[] };

const norm = (v: string | undefined): string => (v ?? "").trim().toLowerCase();
const slug = (v: string): string => v.trim().toLowerCase().replace(/[\s-]+/g, "_");

export function cleanFileName(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_FILE_NAME) : "";
}

export async function importConsents(
  admin: SupabaseClient, tenantId: string, actorId: string | null, rows: ConsentImportRow[], fileName: string,
): Promise<ConsentImportResult> {
  const outcomes: RowOutcome[] = [];
  const changeLog: ConsentImportResult["changeLog"] = [];

  const { data: tenant } = await admin.from("tenants").select("config").eq("id", tenantId).maybeSingle();
  const config = ((tenant as { config?: unknown } | null)?.config ?? null) as Partial<TenantConfig> | null;
  const topics = topicsOf(config);
  const tenantDefaults = consentDefaultsOf(config);

  const matches = await contactsMatchingEmails(admin, tenantId, rows.map((r) => norm(r.values.email)).filter(Boolean));

  const accountIds = [...new Set([...matches.values()].flat().map((c) => c.account_id))];
  const accountById = new Map<string, { country: string | null; type: string }>();
  for (let i = 0; i < accountIds.length; i += 150) {
    const { data } = await admin.from("accounts").select("id, country, type").eq("tenant_id", tenantId).in("id", accountIds.slice(i, i + 150));
    for (const a of (data ?? []) as { id: string; country: string | null; type: string }[]) accountById.set(a.id, { country: a.country, type: a.type });
  }

  const entries: ConsentBatchEntry[] = [];
  const entryRow: { rowNum: number; contactId: string; contactName: string | null; label: string }[] = [];

  for (const row of rows) {
    const v = row.values;
    const fail = (reason: string) => outcomes.push({ rowNum: row.rowNum, status: "failed", reason });

    const email = norm(v.email);
    if (!email) { fail("Email is required."); continue; }

    const statusRaw = norm(v.status);
    if (statusRaw !== "granted" && statusRaw !== "withdrawn") { fail('Status must be "granted" or "withdrawn".'); continue; }
    const status: "granted" | "withdrawn" = statusRaw;

    const channel = norm(v.channel) || "email";
    if (!(STAFF_CHANNELS as readonly string[]).includes(channel)) { fail("Channel must be email, whatsapp, sms or phone."); continue; }

    let topic: string | null = null;
    const topicRaw = (v.topic ?? "").trim();
    if (topicRaw !== "" && slug(topicRaw) !== "all" && slug(topicRaw) !== "all_topics") {
      const hit = topics.find((t) => t.key === topicRaw || slug(t.key) === slug(topicRaw) || slug(t.label) === slug(topicRaw));
      if (!hit) { fail(`"${topicRaw}" isn't one of your workspace's topics. Leave it blank for all topics.`); continue; }
      topic = hit.key;
    }

    const found = matches.get(email);
    if (!found) {
      outcomes.push({ rowNum: row.rowNum, status: "skipped", reason: "No contact has this email address. Consents never create contacts: add the contact first." });
      continue;
    }
    if (found.length > 1) { fail("More than one contact has this email address, so the answer can't be matched to one person. Fix the duplicate in Contacts first."); continue; }
    const contact = found[0];
    const account = accountById.get(contact.account_id);

    const ctx: StaffConsentContext = {
      jurisdiction: jurisdictionForCountry(contact.country || account?.country),
      tenantDefaults,
      isExistingCustomer: !!account && account.type !== "prospect",
    };
    const basis = checkImportBasis(status, norm(v.basis) || null, ctx);
    if (!basis.ok) { fail(basis.error); continue; }

    const note = cleanNote(v.note).slice(0, 300);
    const givenOn = (v.given_on ?? "").trim();
    entries.push({
      contactId: contact.id, accountId: contact.account_id, channel: channel as ConsentBatchEntry["channel"], topic,
      status, basis: basis.basis, jurisdiction: ctx.jurisdiction, source: "import", actorId,
      // The file is the evidence. No address, no name: just where this answer came from.
      evidence: { file_name: fileName, row: row.rowNum, via: "data_workbench", ...(givenOn ? { given_on: givenOn } : {}), ...(note ? { note } : {}) },
    });
    entryRow.push({
      rowNum: row.rowNum, contactId: contact.id, contactName: contact.name,
      label: `${channel}, ${topic === null ? "all topics" : (topics.find((t) => t.key === topic)?.label ?? topic)}`,
    });
  }

  const results = await recordConsentBatch(tenantId, entries, admin);
  entries.forEach((e, i) => {
    const r = results[i];
    const meta = entryRow[i];
    if (!r.ok) { outcomes.push({ rowNum: meta.rowNum, status: "failed", reason: r.pending ? "Consent recording is waiting for a database update." : r.error }); return; }
    outcomes.push({ rowNum: meta.rowNum, status: "inserted" });
    changeLog.push({
      tenantId, objectType: "contacts", objectId: e.contactId, objectLabel: meta.contactName, action: "update",
      changes: [{ field: `Consent: ${meta.label}`, from: null, to: `${e.status === "granted" ? "Agreed" : "Withdrawn"} (import: ${fileName})` }],
    });
  });

  outcomes.sort((a, b) => a.rowNum - b.rowNum);
  return { outcomes, changeLog };
}
