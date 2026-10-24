// The shared Inbox (0214, docs/design/estimator-unification-and-inbox.md). Client-safe: no server imports,
// so the screens, the routes and the tests share one set of statuses, limits and labels.

export const INBOX_STATUSES = ["new", "handled", "spam"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export const INBOX_STATUS_LABEL: Record<InboxStatus, string> = { new: "New", handled: "Handled", spam: "Spam" };

/** What "Create from this email" offers first for a channel. `none` = no default; the menu lists all. */
export const CREATE_TYPES = ["quote", "project", "case", "estimate", "lead"] as const;
export type CreateType = (typeof CREATE_TYPES)[number];
export const DEFAULT_ACTIONS = [...CREATE_TYPES, "none"] as const;
export type DefaultAction = (typeof DEFAULT_ACTIONS)[number];

export const CREATE_LABEL: Record<CreateType, string> = {
  quote: "Quote", project: "Project", case: "Case", estimate: "Estimate", lead: "Lead",
};

/** Object types a converted email can link to. These are the keys change history and OBJECT_FEATURE use. */
export const LINK_OBJECT_TYPES = ["standard_quotes", "wfm_projects", "cases", "estimates", "leads"] as const;
export type LinkObjectType = (typeof LINK_OBJECT_TYPES)[number];

export const CREATE_TO_OBJECT: Record<CreateType, LinkObjectType> = {
  quote: "standard_quotes", project: "wfm_projects", case: "cases", estimate: "estimates", lead: "leads",
};

export const OBJECT_LABEL: Record<LinkObjectType, string> = {
  standard_quotes: "Quote", wfm_projects: "Project", cases: "Case", estimates: "Estimate", leads: "Lead",
};

export const MAILBOX_CONNECTORS = ["gmail", "mail_server"] as const;
export type MailboxConnector = (typeof MAILBOX_CONNECTORS)[number];

// Retention (owner decisions 2026-10-24): a converted email keeps its body 30 days after conversion; a mail that was
// never converted is purged 90 days after it arrived. After that only a stub row stays (sender, subject, link).
export const RETENTION = { convertedDays: 30, neverConvertedDays: 90 } as const;

export const INBOX_LIMITS = {
  maxBodyChars: 60_000,
  maxSubjectChars: 500,
  maxAttachmentsPerMessage: 10,
  maxAttachmentBytes: 15 * 1024 * 1024,
  /** Mail a channel will take per hour before it starts dropping (a flood or a loop, never a busy day). */
  maxPerChannelPerHour: 300,
  pageSize: 25,
  maxPageSize: 100,
  summaryChars: 600,
  snippetChars: 160,
} as const;

export const MAX_CHANNELS = 20;

export type InboxChannel = {
  id: string;
  tenant_id: string;
  name: string;
  address_alias: string;
  connector_id: MailboxConnector | null;
  role_ids: string[];
  default_action: DefaultAction;
  default_template_id: string | null;
  reply_from: string | null;
  reply_name: string | null;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type QualityLabel = "good" | "review" | "poor";
export const QUALITY_LABEL: Record<QualityLabel, string> = { good: "Good", review: "Needs review", poor: "Poor" };

export type InboxAttachment = {
  id: string;
  email_id: string;
  file_name: string;
  mime_type: string | null;
  ext: string | null;
  size_bytes: number;
  quality: QualityLabel;
  quality_note: string | null;
  summary: string | null;
};

/** One row of inbound_emails with the body already decrypted for the viewer (or null on a purged stub). */
export type InboxEmail = {
  id: string;
  tenant_id: string;
  channel_id: string;
  direction: "in" | "out";
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[];
  subject: string;
  snippet: string | null;
  body_text: string | null;
  message_id: string | null;
  thread_key: string | null;
  received_at: string;
  status: InboxStatus;
  assigned_to: string | null;
  linked_object_type: LinkObjectType | null;
  linked_object_id: string | null;
  linked_object_label: string | null;
  converted_at: string | null;
  expires_at: string;
  purged_at: string | null;
  read_at: string | null;
  handled_at: string | null;
  send_status: "sent" | "failed" | "redirected" | null;
  error: string | null;
  created_by: string | null;
};

/** The one-line reasons the screens show when the tables are not there yet. */
export const PENDING_MESSAGE = "The shared Inbox needs migration 0214 applied to this database (scripts/run-bundle-23-inbox-2026-10-24.sql).";

// What the message screen is given (built on the server, serialised to the client; no secrets, no other channel's data).
export type CreateOption = { type: CreateType; available: boolean; reason: string | null };
export type SenderMatchView = { contactId: string; contactName: string | null; accountId: string | null; accountName: string | null };
export type InboxDetailView = {
  email: InboxEmail;
  channel: InboxChannel;
  thread: InboxEmail[];
  attachments: InboxAttachment[];
  sender: { name: string | null; address: string | null; suggestedName: string; match: SenderMatchView | null };
  createOptions: CreateOption[];
  members: { user_id: string; name: string | null; email: string | null }[];
  needsBetterDrawing: boolean;
  /** Estimates can be started from here (module on and the person may create them). */
  estimatesAvailable: boolean;
};
