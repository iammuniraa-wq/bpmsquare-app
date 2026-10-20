import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn() }));

import { getEffectiveFieldConfig } from "./fieldConfig";
import { fakeDb } from "@/lib/marketing/testFakeDb";
import type { SupabaseClient } from "@supabase/supabase-js";

// preferred_language (0143) belongs to the Newsletter Studio: a workspace without it must see no new
// field on a form, an export or an import, and a pending migration must never make a save fail.

const T = "t1";
const keys = async (client: SupabaseClient, type: string) =>
  (await getEffectiveFieldConfig(client, T, type)).sections.flatMap((s) => s.fields.map((f) => f.field_key));

const base = (features: Record<string, boolean>, opts: { missingTables?: string[] } = {}) =>
  fakeDb({ custom_fields: [], field_overrides: [], field_rules: [], tenants: [{ id: T, features }], accounts: [], contacts: [] }, opts).client;

describe("preferred_language is a gated field", () => {
  it("is absent for a workspace without the Newsletter Studio, on both objects", async () => {
    const c = base({ marketing: true });
    expect(await keys(c, "account")).not.toContain("preferred_language");
    expect(await keys(c, "contact")).not.toContain("preferred_language");
  });

  it("is offered once the workspace has the studio", async () => {
    const c = base({ marketing: true, newsletter_studio: true });
    expect(await keys(c, "account")).toContain("preferred_language");
    expect(await keys(c, "contact")).toContain("preferred_language");
  });

  it("stays hidden while the migration is pending, so a save can never hit a column that is not there", async () => {
    const fake = fakeDb({ custom_fields: [], field_overrides: [], field_rules: [], tenants: [{ id: T, features: { newsletter_studio: true } }], accounts: [], contacts: [] });
    const real = fake.client.from.bind(fake.client);
    (fake.client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = real(t) as { select: (c: string) => unknown };
      if (t === "accounts") {
        const orig = q.select.bind(q);
        q.select = (c: string) => (c === "preferred_language" ? { eq: () => ({ limit: async () => ({ data: null, error: { code: "42703", message: "column accounts.preferred_language does not exist" } }) }) } : orig(c));
      }
      return q;
    };
    expect(await keys(fake.client, "account")).not.toContain("preferred_language");
  });

  it("does not touch any other object", async () => {
    const c = base({ newsletter_studio: true });
    expect(await keys(c, "supplier")).not.toContain("preferred_language");
  });
});
