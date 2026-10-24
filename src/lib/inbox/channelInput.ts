import { DEFAULT_ACTIONS, MAILBOX_CONNECTORS, type DefaultAction, type MailboxConnector } from "./types";

// What a channel's settings form may send, checked in one place (pure, so the route and its tests share it). Anything not
// listed here is ignored: the allow-list is the PATCH contract. Ids (roles, template) are only shape-checked here; the
// route verifies they belong to this workspace before they are stored.

export type ChannelValues = {
  name?: string;
  role_ids?: string[];
  default_action?: DefaultAction;
  default_template_id?: string | null;
  reply_from?: string | null;
  reply_name?: string | null;
  connector_id?: MailboxConnector | null;
  active?: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function parseChannelInput(raw: unknown, opts: { create: boolean }): { ok: true; values: ChannelValues; rotate: boolean } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Bad request" };
  const b = raw as Record<string, unknown>;
  const values: ChannelValues = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);

  if (opts.create || has("name")) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name) return { ok: false, error: "Give the channel a name." };
    if (name.length > 80) return { ok: false, error: "The name can be at most 80 characters." };
    values.name = name;
  }
  if (has("role_ids")) {
    if (!Array.isArray(b.role_ids) || b.role_ids.some((r) => typeof r !== "string" || !UUID.test(r))) return { ok: false, error: "Pick the team from the list." };
    values.role_ids = [...new Set(b.role_ids as string[])].slice(0, 30);
  }
  if (has("default_action")) {
    if (!(DEFAULT_ACTIONS as readonly unknown[]).includes(b.default_action)) return { ok: false, error: "Pick what Create offers first from the list." };
    values.default_action = b.default_action as DefaultAction;
  }
  if (has("default_template_id")) {
    if (b.default_template_id !== null && b.default_template_id !== "" && (typeof b.default_template_id !== "string" || !UUID.test(b.default_template_id))) return { ok: false, error: "Pick the template from the list." };
    values.default_template_id = (b.default_template_id as string | null) || null;
  }
  if (has("reply_from")) {
    const v = typeof b.reply_from === "string" ? b.reply_from.trim().toLowerCase() : "";
    if (v && !EMAIL.test(v)) return { ok: false, error: "That does not look like an email address." };
    values.reply_from = v || null;
  }
  if (has("reply_name")) {
    const v = typeof b.reply_name === "string" ? b.reply_name.trim() : "";
    if (v.length > 120) return { ok: false, error: "The sender name can be at most 120 characters." };
    values.reply_name = v || null;
  }
  if (has("connector_id")) {
    if (b.connector_id !== null && b.connector_id !== "" && !(MAILBOX_CONNECTORS as readonly unknown[]).includes(b.connector_id)) return { ok: false, error: "Pick Gmail or Mail server." };
    values.connector_id = (b.connector_id as MailboxConnector | null) || null;
  }
  if (has("active")) {
    if (typeof b.active !== "boolean") return { ok: false, error: "active must be yes or no." };
    values.active = b.active;
  }
  return { ok: true, values, rotate: b.rotate_alias === true };
}
