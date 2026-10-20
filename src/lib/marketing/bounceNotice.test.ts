import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyOwnerOfBounce } from "./bounceNotice";
import { fakeDb } from "./testFakeDb";

const T = "11111111-1111-4111-8111-111111111111";
const OWNER = "oooooooo-oooo-4ooo-8ooo-oooooooooooo";

function world(features: Record<string, boolean>, member = true) {
  const db = fakeDb({
    tenants: [{ id: T, features }],
    accounts: [{ id: "acc-1", tenant_id: T, owner_user_id: OWNER }],
    tenant_users: member ? [{ tenant_id: T, user_id: OWNER }] : [],
  });
  const client = Object.assign(db.client, { auth: { admin: { getUserById: async () => ({ data: { user: { email: "Owner@Company.com" } } }) } } }) as SupabaseClient;
  return { client, tables: db.tables };
}

describe("notifyOwnerOfBounce", () => {
  it("writes one system comment on the contact that mentions the account owner", async () => {
    const { client, tables } = world({ next_experience: true });
    expect(await notifyOwnerOfBounce(client, T, { contactId: "c1", accountId: "acc-1", contactName: "Asha" })).toBe(true);
    expect(tables.record_comments).toHaveLength(1);
    expect(tables.record_comments[0]).toMatchObject({ tenant_id: T, object_type: "contacts", object_id: "c1", author_email: null, mentions: ["owner@company.com"] });
    expect(String(tables.record_comments[0].body)).toContain("Asha");
  });

  it("does nothing in a workspace without the Nova experience", async () => {
    const { client, tables } = world({});
    expect(await notifyOwnerOfBounce(client, T, { contactId: "c1", accountId: "acc-1" })).toBe(false);
    expect(tables.record_comments ?? []).toHaveLength(0);
  });

  it("does nothing when the owner is not a member of this tenant", async () => {
    const { client, tables } = world({ next_experience: true }, false);
    expect(await notifyOwnerOfBounce(client, T, { contactId: "c1", accountId: "acc-1" })).toBe(false);
    expect(tables.record_comments ?? []).toHaveLength(0);
  });
});
