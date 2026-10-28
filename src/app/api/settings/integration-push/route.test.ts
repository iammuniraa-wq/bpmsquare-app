import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/marketing/testFakeDb";

// The signing secret is write-only: GET never returns it, Regenerate returns the new one once, and what is stored stays sealed.

const state = vi.hoisted(() => ({ db: null as unknown, role: "admin" }));

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ tenantId: "t1", role: state.role }),
  createAdminSupabase: () => state.db,
}));
vi.mock("@/lib/net/safeHost", () => ({ assertPublicHttpUrl: async () => undefined }));

import { NextRequest } from "next/server";

const patch = async (body: unknown) => {
  const { PATCH } = await import("./route");
  return PATCH(new NextRequest(new URL("http://internal.invalid/api/settings/integration-push"), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
};

beforeEach(() => { state.role = "admin"; process.env.FIELD_ENCRYPTION_KEY = "a".repeat(64); });

describe("/api/settings/integration-push", () => {
  it("GET masks the signing secrets (tenant-level and per endpoint)", async () => {
    const { sealIntegrationPush } = await import("@/lib/webhookPush");
    const stored = sealIntegrationPush({
      webhook_url: "https://erp.example.com/hook", webhook_secret: "default-secret-value",
      endpoints: [{ id: "e1", name: "Plant 2", webhook_url: "https://erp2.example.com/hook", webhook_secret: "endpoint-secret-value" }],
    });
    state.db = fakeDb({ tenants: [{ id: "t1", config: { integration_push: stored } }] }).client;
    const { GET } = await import("./route");
    const res = await GET();
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain("default-secret-value");
    expect(text).not.toContain("endpoint-secret-value");
    expect(text).toContain("https://erp.example.com/hook");
    expect(text).toContain("••••••••");
  }, 60_000);

  it("Regenerate returns the new secret once, stores it sealed, and the outbound signing can still read it", async () => {
    const db = fakeDb({ tenants: [{ id: "t1", config: { integration_push: { webhook_url: "https://erp.example.com/hook" } } }] });
    state.db = db.client;
    const res = await patch({ regenerate_secret: true });
    const json = await res.json();
    expect(json.webhook_secret).toMatch(/^[0-9a-f]{48}$/);
    const stored = (db.tables.tenants[0].config as { integration_push: { webhook_secret: string } }).integration_push.webhook_secret;
    expect(stored).not.toBe(json.webhook_secret);
    const { unsealSecret } = await import("@/lib/encryption");
    expect(unsealSecret(stored)).toBe(json.webhook_secret);

    // a later save of the URL does not hand the secret back
    const again = await (await patch({ webhook_url: "https://erp.example.com/other" })).json();
    expect(again.webhook_secret).toBe("••••••••");
    expect(JSON.stringify(again)).not.toContain(json.webhook_secret);
  }, 60_000);
});
