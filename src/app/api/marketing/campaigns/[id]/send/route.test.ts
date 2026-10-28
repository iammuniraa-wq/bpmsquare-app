import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/marketing/testFakeDb";

// A plain (non-newsletter) campaign must pass the same per-person consent gate as newsletters, journeys and WhatsApp.
// Before this, only accounts.marketing_opt_out and the presence of an address were checked.

const state = vi.hoisted(() => ({
  db: null as unknown,
  sent: [] as Record<string, unknown>[],
  gateCalls: [] as { contactId: string; topic: string | null }[],
  candidates: [] as Record<string, unknown>[],
}));

vi.mock("resend", () => ({ Resend: class { emails = { send: async (m: Record<string, unknown>) => { state.sent.push(m); return { data: { id: "re_1" }, error: null }; } }; } }));
vi.mock("@/lib/marketingAccess", () => ({ requireMarketingAccess: async () => ({ auth: { supabase: state.db, tenantId: "t1" } }) }));
vi.mock("@/lib/supabase-server", () => ({ getAuthUser: async () => ({ id: "u1", email: "u@x.example" }), createAdminSupabase: () => state.db }));
vi.mock("@/lib/data", () => ({ resolveMarketingRecipients: async () => state.candidates }));
vi.mock("@/lib/marketing/consent", () => ({
  canContact: async (_t: string, contactId: string, _ch: string, topic: string | null) => {
    state.gateCalls.push({ contactId, topic });
    return contactId === "k2" ? { ok: false, reason: "no_consent" } : { ok: true, reason: "consented" };
  },
}));
vi.mock("@/lib/marketingUnsubscribe", () => ({ signUnsubscribeToken: () => "tok" }));
vi.mock("@/lib/campaignInterestLink", () => ({ signCampaignInterestToken: () => "tok" }));
vi.mock("@/lib/quotePublicLink", () => ({ buildAbsoluteUrl: async (p: string) => `https://x.example${p}` }));
vi.mock("@/lib/emailLog", () => ({ logEmail: async () => undefined }));
vi.mock("@/lib/emailOutput", () => ({
  loadEmailOutput: async () => ({}),
  resolveOutbound: (_o: unknown, email: Record<string, unknown>) => ({ ok: true, email }),
}));
vi.mock("@/lib/events/emitters", () => ({ emitCampaignSent: async () => undefined }));
vi.mock("@/lib/newsletter/sendRoute", () => ({ sendNewsletterBranch: async () => { throw new Error("not a newsletter"); } }));

import { NextRequest } from "next/server";
import { POST } from "./route";

const cand = (account_id: string, email: string) => ({ account_id, account_name: account_id, email, marketing_opt_out: false, manual_email: null });

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test";
  state.sent = []; state.gateCalls = [];
  state.candidates = [cand("a1", "one@x.example"), cand("a2", "two@x.example")];
});

describe("POST /api/marketing/campaigns/[id]/send (plain campaign)", () => {
  it("skips a recipient with no consent for the topic and counts it, like the newsletter path", async () => {
    const tables = fakeDb({
      tenants: [{ id: "t1", name: "Al Noor", slug: "alnoor", company_info: null }],
      marketing_campaigns: [{ id: "c1", tenant_id: "t1", name: "Offers", status: "draft", subject: "Hi", body: "<p>Hello</p>", topic: "offers" }],
      contacts: [
        { id: "k1", tenant_id: "t1", account_id: "a1", email: "one@x.example", created_at: "2026-01-01" },
        { id: "k2", tenant_id: "t1", account_id: "a2", email: "two@x.example", created_at: "2026-01-01" },
      ],
      marketing_campaign_recipients: [],
    });
    state.db = tables.client;

    const res = await POST(
      new NextRequest(new URL("http://internal.invalid/api/marketing/campaigns/c1/send"), { method: "POST" }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(await res!.json()).toEqual({ sent: 1, failed: 0, skipped: 1 });
    expect(state.gateCalls).toEqual([{ contactId: "k1", topic: "offers" }, { contactId: "k2", topic: "offers" }]);
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].to).toEqual(["one@x.example"]);
    const rows = tables.tables.marketing_campaign_recipients;
    expect(rows.find((r) => r.account_id === "a2")).toMatchObject({ status: "skipped_no_consent", error: "no_consent", contact_id: "k2" });
    expect(rows.find((r) => r.account_id === "a1")).toMatchObject({ status: "sent" });
    expect(tables.tables.marketing_campaigns[0]).toMatchObject({ status: "sent", sent_count: 1, skipped_count: 1 });
  });

  it("still skips an opted-out account and an address-less recipient without asking the gate", async () => {
    const tables = fakeDb({
      tenants: [{ id: "t1", name: "Al Noor", slug: "alnoor", company_info: null }],
      marketing_campaigns: [{ id: "c1", tenant_id: "t1", name: "Offers", status: "draft", subject: "Hi", body: "<p>Hello</p>", topic: null }],
      contacts: [],
      marketing_campaign_recipients: [],
    });
    state.db = tables.client;
    state.candidates = [{ ...cand("a1", "one@x.example"), marketing_opt_out: true }, { ...cand("a2", ""), email: null }];
    const res = await POST(
      new NextRequest(new URL("http://internal.invalid/api/marketing/campaigns/c1/send"), { method: "POST" }),
      { params: Promise.resolve({ id: "c1" }) },
    );
    expect(await res!.json()).toEqual({ sent: 0, failed: 0, skipped: 2 });
    expect(state.gateCalls).toEqual([]);
    const statuses = tables.tables.marketing_campaign_recipients.map((r) => r.status);
    expect(statuses).toEqual(["skipped_opt_out", "skipped_no_email"]);
  });
});
