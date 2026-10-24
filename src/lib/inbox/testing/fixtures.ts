// Shared fixtures for the Inbox tests: two workspaces, channels with and without a team, a mail builder, and PNG / PDF /
// DXF byte strings that really are those files. Test helper only.

import { randomBytes } from "node:crypto";
import { MemoryDb, type Row } from "./memoryDb";
import type { InboxMail } from "../ingest";
import type { InboxChannel } from "../types";

export const T1 = "11111111-1111-4111-8111-111111111111";
export const T2 = "22222222-2222-4222-8222-222222222222";
export const CH_OPEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const CH_TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const CH_OTHER_TENANT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const ROLE_SALES = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export const ROLE_OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
export const U_ADMIN = "00000000-0000-4000-8000-0000000000a1";
export const U_SALES = "00000000-0000-4000-8000-0000000000a2";
export const U_PLAIN = "00000000-0000-4000-8000-0000000000a3";
export const DOMAIN = "in.bpmsquare.test";

export const ALIAS_OPEN = "inbox-aaaaaaaaaaaaaaaa";
export const ALIAS_TEAM = "inbox-bbbbbbbbbbbbbbbb";
export const ALIAS_OTHER = "inbox-cccccccccccccccc";

export const channelRow = (over: Partial<InboxChannel> & { id: string; tenant_id: string; address_alias: string }): Row => ({
  name: "Fence enquiries", connector_id: null, role_ids: [], default_action: "quote", default_template_id: null, reply_from: null, reply_name: null,
  active: true, last_received_at: null, ...over,
});

export function world(): MemoryDb {
  const db = new MemoryDb({
    tenants: [
      { id: T1, slug: "gulf", name: "Gulf Fence", is_demo: false, features: { inbox: true, standard_quotes: true, cases: true, leads: true, wfm_projects: true, estimator: true }, config: {}, company_info: { email: "hello@gulf.test" } },
      { id: T2, slug: "other", name: "Other Co", is_demo: false, features: { inbox: true }, config: {}, company_info: null },
    ],
    inbox_channels: [
      channelRow({ id: CH_OPEN, tenant_id: T1, address_alias: ALIAS_OPEN, name: "Fence enquiries" }),
      channelRow({ id: CH_TEAM, tenant_id: T1, address_alias: ALIAS_TEAM, name: "Tiles", role_ids: [ROLE_SALES] }),
      channelRow({ id: CH_OTHER_TENANT, tenant_id: T2, address_alias: ALIAS_OTHER, name: "Other tenant" }),
    ],
    tenant_users: [
      { tenant_id: T1, user_id: U_ADMIN, role: "admin" }, { tenant_id: T1, user_id: U_SALES, role: "member" }, { tenant_id: T1, user_id: U_PLAIN, role: "member" },
    ],
    business_user_roles: [{ tenant_id: T1, user_id: U_SALES, role_id: ROLE_SALES }],
  });
  db.users.set(U_ADMIN, { email: "admin@gulf.test", name: "Admin" });
  db.users.set(U_SALES, { email: "sales@gulf.test", name: "Sales" });
  db.users.set(U_PLAIN, { email: "plain@gulf.test", name: "Plain" });
  // The same unique indexes the migration creates.
  db.unique("inbound_emails", (e, n) => e.tenant_id === n.tenant_id && e.provider_message_id === n.provider_message_id);
  db.unique("inbound_emails", (e, n) => !!n.message_id && n.direction === "in" && e.tenant_id === n.tenant_id && e.channel_id === n.channel_id && e.message_id === n.message_id && e.direction === "in");
  db.unique("inbox_channels", (e, n) => e.address_alias === n.address_alias);
  return db;
}

let n = 0;
export function mail(over: Partial<InboxMail> = {}): InboxMail {
  n += 1;
  return {
    provider: "resend", providerMessageId: `prov-${n}`, messageId: `<m${n}@customer.test>`, inReplyTo: null, references: null,
    from: "Sara Khan <sara@customer.test>", to: [`${ALIAS_OPEN}@${DOMAIN}`], subject: "Fence for 300 m", text: "Please quote 300 m of fence, 2 m high.",
    html: null, headers: {}, attachments: [], ...over,
  };
}

export const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(40_000, 0x61)]);
export const SMALL_PDF = Buffer.from("%PDF-1.4\nx");
export const PNG_BIG = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n"), Buffer.from([0x1a, 0x0a]), Buffer.alloc(300_000, 1)]);
export const PNG_SMALL = Buffer.concat([Buffer.from([0x89]), Buffer.from("PNG\r\n"), Buffer.from([0x1a, 0x0a]), Buffer.alloc(2_000, 1)]);
export const DXF = Buffer.from("  0\r\nSECTION\r\n  2\r\nHEADER\r\n  0\r\nENDSEC\r\n  0\r\nEOF\r\n");
export const DWG = Buffer.concat([Buffer.from("AC1032"), Buffer.alloc(5_000, 2)]);
export const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.from([0x90, 0, 3, 0, 0, 0, 4, 0]), Buffer.alloc(500, 0)]);
export const ZIP = Buffer.concat([Buffer.from("PK"), Buffer.from([3, 4]), Buffer.from("....evil/payload.bin....")]);

export const ENV_KEY = randomBytes(32).toString("hex");

export const file = (filename: string, content: Buffer, contentType = "application/octet-stream") => ({ filename, contentType, content });
