import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));

import { createAdminSupabase } from "@/lib/supabase-server";
import { sendNewsletterCampaign, type CampaignRow, type SendInput } from "@/lib/newsletter/send";
import type { StoredVersion } from "@/lib/newsletter/server";
import { emailOutputFor } from "@/lib/emailOutputRules";
import { fakeDb } from "../testFakeDb";
import { verifyPreferenceToken } from "./preferenceToken";

// The Newsletter Studio's "Manage preferences" link opens the preference centre when the workspace has it,
// and the plain unsubscribe page otherwise. The token is bound to the person the email is for.

const T = "t1";
const campaign: CampaignRow = { id: "camp", name: "October", topic: "offers", languages: ["en"], fallback_language: "en", newsletter_version_id: "v1" };
const version: StoredVersion = {
  id: "v1", newsletter_id: "n1", version: 1,
  snapshot: { name: "October", blocks: [], languages: [{ lang: "en", dir: "ltr", subject: "Hello", preheader: "", texts: {}, review: {}, status: "ready" }], kit: {} as never, topic: "offers", open_pixel: false },
  html: { en: '<a href="{{unsubscribe_url}}">u</a><a href="{{preferences_url}}">p</a>' },
  text: { en: "{{preferences_url}}" },
  links: [],
};

let saved: string | undefined;
beforeEach(() => { saved = process.env.QUOTE_PUBLIC_LINK_SECRET; process.env.QUOTE_PUBLIC_LINK_SECRET = "test-secret"; });
afterEach(() => { process.env.QUOTE_PUBLIC_LINK_SECRET = saved; });

async function run(preferencesEnabled?: boolean) {
  const db = fakeDb({
    contacts: [{ id: "k1", tenant_id: T, account_id: "a1", name: "Layla", email: "layla@one.example", created_at: "2026-01-01" }],
    accounts: [{ id: "a1", tenant_id: T }], marketing_campaign_recipients: [], domain_event: [], email_log: [], marketing_campaigns: [],
  });
  vi.mocked(createAdminSupabase).mockReturnValue(db.client as never);
  const sent: Record<string, unknown>[] = [];
  const input: SendInput = {
    supabase: db.client, admin: db.client, tenantId: T, userId: "u1", userEmail: "u@x.example", campaign, version,
    candidates: [{ account_id: "a1", account_name: "One", email: "layla@one.example", marketing_opt_out: false, manual_email: null }],
    resend: { emails: { send: async (m) => { sent.push(m); return { data: { id: "re_1" }, error: null }; } } },
    output: emailOutputFor({ is_demo: false, config: null }),
    companyName: "Al Noor", fromAddress: "Al Noor <alnoor@bpmsquare.com>", absoluteUrl: async (p) => `https://crm.alnoor.test${p}`,
    gate: async () => ({ ok: true, reason: "consented" }), delayMs: 0, preferencesEnabled,
  };
  await sendNewsletterCampaign(input);
  return String(sent[0]?.html ?? "");
}

describe("Manage preferences in a newsletter", () => {
  it("opens the person's own preference centre, on the workspace's domain, when the workspace has it", async () => {
    const html = await run(true);
    const m = html.match(/https:\/\/crm\.alnoor\.test\/marketing\/preferences\/k1\/([A-Za-z0-9_-]+)/);
    expect(m).not.toBeNull();
    expect(verifyPreferenceToken("k1", m![1])).toBe(true);
    expect(verifyPreferenceToken("k2", m![1])).toBe(false);
  });

  it("keeps opening the unsubscribe page when it does not", async () => {
    for (const flag of [false, undefined]) {
      const html = await run(flag);
      expect(html).not.toContain("/marketing/preferences/");
      expect((html.match(/\/marketing\/unsubscribe\/a1\//g) ?? []).length).toBe(2);
    }
  });
});
