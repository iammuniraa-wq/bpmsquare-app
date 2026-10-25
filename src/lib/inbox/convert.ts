import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt, encrypt } from "@/lib/encryption";
import { diffForLog, logChange } from "@/lib/changeLog";
import { findContactByEmail } from "@/lib/marketing/contactLookup";
import { emitEmailConverted, emitEmailHandled } from "@/lib/events/emitters";
import { ATTACHMENT_BUCKET } from "./server";
import { LINK_TABLE } from "./links";
import { expiryOnConversion, summarise } from "./rules";
import { OBJECT_LABEL, type CreateType, type InboxChannel, type LinkObjectType } from "./types";

// Create from this email. The record is made by the object's OWN create route (so every validation, foreign-id check,
// master reference, change-history entry and event the "New" form triggers applies unchanged); this module then:
//   1. copies the email's files onto the record (they outlive the email's own retention),
//   2. stores who wrote and a short summary on the record (record_sources),
//   3. links the message to the record, marks it handled, and lets the retention clock restart at 30 days,
//   4. writes the change history and the events.
// The mail is read as data. Nothing in it chooses the record, the account or the recipient.

export const COPY_BUCKET_QUOTES = "quote-attachments";

export type CreateInput = {
  type: CreateType;
  accountId: string | null;
  contactId: string | null;
  /** The message being converted (a deal records it as its source e-mail). */
  emailId?: string | null;
  /** Quote: not used. Project / Lead: the name. Case: the equipment, shown in the list. */
  title: string;
  caseType?: "adhoc" | "direct" | "amc";
  complaint?: string;
};

export type Created = { ok: true; id: string; label: string } | { ok: false; error: string; status: number };
export type Creators = Record<Exclude<CreateType, "estimate">, (input: CreateInput) => Promise<Created>>;

export type SenderMatch = { contactId: string; contactName: string | null; accountId: string | null; accountName: string | null };

/** Who in the address book is this sender? By the contact's e-mail blind index, tenant-scoped. */
export async function matchSender(admin: SupabaseClient, tenantId: string, from: string | null): Promise<SenderMatch | null> {
  const c = await findContactByEmail(admin, tenantId, from);
  if (!c) return null;
  let accountName: string | null = null;
  if (c.account_id) {
    const { data: a } = await admin.from("accounts").select("name").eq("id", c.account_id).eq("tenant_id", tenantId).maybeSingle();
    accountName = (a?.name as string | undefined) ?? null;
  }
  return { contactId: c.id, contactName: c.name, accountId: c.account_id, accountName };
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────────────────────────────

async function copyObject(admin: SupabaseClient, fromBucket: string, from: string, toBucket: string, to: string, mime: string | null): Promise<boolean> {
  if (fromBucket === toBucket) {
    const { error } = await admin.storage.from(fromBucket).copy(from, to);
    return !error;
  }
  const dl = await admin.storage.from(fromBucket).download(from);
  if (dl.error || !dl.data) return false;
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const up = await admin.storage.from(toBucket).upload(to, buf, { contentType: mime ?? undefined, upsert: false });
  return !up.error;
}

type AttRow = { id: string; file_name: string; storage_path: string; mime_type: string | null; ext: string | null; size_bytes: number };

/**
 * Copies every file of the email onto the record. A Standard Quote has its own Attachments (and the "create lines from
 * this spreadsheet" feature reads them), so its files go there; every other record gets record_files. Returns how many
 * landed. A file that cannot be copied is skipped and counted out, never silently claimed.
 */
export async function copyAttachmentsToRecord(admin: SupabaseClient, args: {
  tenantId: string; emailId: string; objectType: LinkObjectType; objectId: string; actorId: string | null;
}): Promise<{ copied: number; total: number }> {
  const { tenantId, emailId, objectType, objectId } = args;
  const { data } = await admin.from("inbound_email_attachments")
    .select("id, file_name, storage_path, mime_type, ext, size_bytes").eq("tenant_id", tenantId).eq("email_id", emailId);
  const files = (data ?? []) as AttRow[];
  let copied = 0;
  for (const f of files) {
    const ext = f.ext ?? "bin";
    if (objectType === "standard_quotes") {
      const to = `${tenantId}/${objectId}/${randomUUID()}.${ext}`;
      if (!(await copyObject(admin, ATTACHMENT_BUCKET, f.storage_path, COPY_BUCKET_QUOTES, to, f.mime_type))) continue;
      const { error } = await admin.from("standard_quote_attachments").insert({
        tenant_id: tenantId, standard_quote_id: objectId, file_name: f.file_name, storage_path: to, mime_type: f.mime_type,
        size_bytes: f.size_bytes, note: "From the customer's email", uploaded_by: args.actorId,
      });
      if (error) { await admin.storage.from(COPY_BUCKET_QUOTES).remove([to]); continue; }
    } else {
      const to = `${tenantId}/records/${objectType}/${objectId}/${randomUUID()}.${ext}`;
      if (!(await copyObject(admin, ATTACHMENT_BUCKET, f.storage_path, ATTACHMENT_BUCKET, to, f.mime_type))) continue;
      const { error } = await admin.from("record_files").insert({
        tenant_id: tenantId, object_type: objectType, object_id: objectId, file_name: f.file_name, storage_path: to, mime_type: f.mime_type,
        size_bytes: f.size_bytes, source: "email", source_email_id: emailId, created_by: args.actorId,
      });
      if (error) { await admin.storage.from(ATTACHMENT_BUCKET).remove([to]); continue; }
    }
    copied++;
  }
  return { copied, total: files.length };
}

// ── Linking ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type FinishResult = { ok: true; copied: number; total: number } | { ok: false; error: string; status: number };

/**
 * Everything that happens once a record exists for an email: files copied, sender and summary stored on the record, the
 * message linked and handled, the retention clock restarted, history and events written. The record is verified to be
 * this workspace's before anything is linked to it, and so is the message.
 */
export async function finishConversion(admin: SupabaseClient, args: {
  tenantId: string;
  emailId: string;
  objectType: LinkObjectType;
  objectId: string;
  objectLabel: string;
  accountId?: string | null;
  actor: { id: string | null; email: string | null };
  now?: Date;
}): Promise<FinishResult> {
  const { tenantId, emailId, objectType, objectId } = args;
  const now = args.now ?? new Date();

  const { data: target } = await admin.from(LINK_TABLE[objectType]).select("id").eq("id", objectId).eq("tenant_id", tenantId).maybeSingle();
  if (!target) return { ok: false, error: "That record was not found in this workspace.", status: 404 };

  const { data: row } = await admin.from("inbound_emails")
    .select("id, channel_id, thread_key, status, direction, subject, from_address, from_name, body_text, received_at, linked_object_id")
    .eq("id", emailId).eq("tenant_id", tenantId).maybeSingle();
  const email = row as { id: string; channel_id: string; thread_key: string | null; status: string; direction: string; subject: string; from_address: string | null; from_name: string | null; body_text: string | null; received_at: string; linked_object_id: string | null } | null;
  if (!email || email.direction !== "in") return { ok: false, error: "Message not found.", status: 404 };

  const { data: ch } = await admin.from("inbox_channels").select("name").eq("id", email.channel_id).eq("tenant_id", tenantId).maybeSingle();
  const channelName = (ch?.name as string | undefined) ?? "Inbox";

  const files = await copyAttachmentsToRecord(admin, { tenantId, emailId, objectType, objectId, actorId: args.actor.id });

  // Who wrote and what they asked, on the record, before the email's own copy can expire.
  let plain: string | null = null;
  try { plain = decrypt(email.body_text); } catch { plain = null; }
  const summary = summarise(plain ?? "");
  await admin.from("record_sources").upsert({
    tenant_id: tenantId, object_type: objectType, object_id: objectId, source_email_id: emailId, channel_name: channelName,
    from_address: email.from_address, from_name: email.from_name, subject: (email.subject ?? "").slice(0, 500), summary: summary ? encrypt(summary) : null,
    received_at: email.received_at, created_by: args.actor.id,
  }, { onConflict: "tenant_id,object_type,object_id,source_email_id" });

  const nowIso = now.toISOString();
  const expires = expiryOnConversion(now).toISOString();
  const wasHandled = email.status === "handled";
  await admin.from("inbound_emails").update({
    linked_object_type: objectType, linked_object_id: objectId, linked_object_label: args.objectLabel.slice(0, 200),
    converted_at: nowIso, status: "handled", handled_at: wasHandled ? undefined : nowIso, handled_by: wasHandled ? undefined : args.actor.id,
    read_at: nowIso, expires_at: expires,
  }).eq("id", emailId).eq("tenant_id", tenantId);
  // The rest of the conversation (our replies, later messages) goes with it: one clock for the thread.
  if (email.thread_key) {
    await admin.from("inbound_emails").update({ expires_at: expires })
      .eq("tenant_id", tenantId).eq("channel_id", email.channel_id).eq("thread_key", email.thread_key).is("purged_at", null);
  }

  if (args.accountId) {
    await admin.from("activities").insert({
      tenant_id: tenantId, account_id: args.accountId, pillar: "sales",
      text: `${OBJECT_LABEL[objectType]} ${args.objectLabel} created from an email from ${email.from_name || email.from_address || "a customer"}`,
    });
  }

  await logChange(admin, {
    tenantId, objectType: "inbound_emails", objectId: emailId, objectLabel: `${channelName} · email ${emailId.slice(0, 8)}`,
    action: "update", actorId: args.actor.id, actorEmail: args.actor.email,
    changes: diffForLog("inbound_emails", { status: email.status, linked_object_type: null, linked_object_id: null }, {
      status: "handled", linked_object_type: objectType, linked_object_id: objectId,
    }),
  });
  await emitEmailConverted(tenantId, { emailId, channelId: email.channel_id, objectType, objectId, accountId: args.accountId, actorId: args.actor.id, attachments: files.copied });
  if (!wasHandled) await emitEmailHandled(tenantId, { emailId, channelId: email.channel_id, status: "handled", via: "conversion", actorId: args.actor.id });
  return { ok: true, copied: files.copied, total: files.total };
}

// ── The whole action ────────────────────────────────────────────────────────────────────────────────────────────────

export type ConvertResult =
  | { ok: true; objectType: LinkObjectType; objectId: string; label: string; copied: number; total: number }
  | { ok: false; error: string; status: number };

const TYPE_TO_OBJECT: Record<Exclude<CreateType, "estimate">, LinkObjectType> = {
  quote: "standard_quotes", project: "wfm_projects", case: "cases", lead: "leads", deal: "opportunities",
};

/** Create the record (through its own route), then finish the conversion. Estimates are made in the workspace, not here. */
export async function convertEmail(admin: SupabaseClient, args: {
  tenantId: string;
  email: { id: string; direction: "in" | "out"; purged_at: string | null; linked_object_id: string | null; linked_object_label: string | null };
  channel: Pick<InboxChannel, "id" | "name">;
  input: CreateInput;
  actor: { id: string | null; email: string | null };
  creators: Creators;
  now?: Date;
}): Promise<ConvertResult> {
  const { email, input } = args;
  if (email.direction !== "in") return { ok: false, error: "Only a customer's message can be turned into a record.", status: 422 };
  if (email.purged_at) return { ok: false, error: "This email has been cleared, so there is nothing left to create from.", status: 410 };
  if (email.linked_object_id) return { ok: false, error: `This email already became ${email.linked_object_label ?? "a record"}.`, status: 409 };
  if (input.type === "estimate") return { ok: false, error: "Estimates are made in the estimate workspace.", status: 422 };

  const made = await args.creators[input.type](input);
  if (!made.ok) return made;
  const objectType = TYPE_TO_OBJECT[input.type];
  const done = await finishConversion(admin, {
    tenantId: args.tenantId, emailId: email.id, objectType, objectId: made.id, objectLabel: made.label,
    accountId: input.accountId, actor: args.actor, now: args.now,
  });
  if (!done.ok) return done;
  return { ok: true, objectType, objectId: made.id, label: made.label, copied: done.copied, total: done.total };
}
