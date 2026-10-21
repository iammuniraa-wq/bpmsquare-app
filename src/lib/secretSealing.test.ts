import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";

// Audit 2026-10-21 (H3): tenants.config is readable by every member of the workspace through
// PostgREST, so the signing key of the ERP push and the auth header of an Account 360 source must
// be stored encrypted. These tests pin the seal/unseal contract and that nothing but the admin
// ever gets the real value back.

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString("hex");
});

describe("sealSecret / unsealSecret", () => {
  it("stores ciphertext, returns the original, and never double-seals", async () => {
    const { sealSecret, unsealSecret } = await import("./encryption");
    const sealed = sealSecret("Bearer s3cret-token");
    expect(sealed).toMatch(/^enc:v1:/);
    expect(sealed).not.toContain("s3cret-token");
    expect(sealSecret(sealed)).toBe(sealed);
    expect(unsealSecret(sealed)).toBe("Bearer s3cret-token");
  });

  it("keeps working for a value saved before sealing existed", async () => {
    const { unsealSecret, sealSecret } = await import("./encryption");
    expect(unsealSecret("legacy-plaintext")).toBe("legacy-plaintext");
    expect(unsealSecret(sealSecret("legacy-plaintext"))).toBe("legacy-plaintext");
  });

  it("treats empty, missing and corrupted values as no secret", async () => {
    const { sealSecret, unsealSecret } = await import("./encryption");
    expect(sealSecret("")).toBeUndefined();
    expect(sealSecret(undefined)).toBeUndefined();
    expect(unsealSecret(undefined)).toBeUndefined();
    expect(unsealSecret("enc:v1:AAAA:BBBB:CCCC")).toBeUndefined();
  });
});

describe("integration push secrets", () => {
  const plain = {
    webhook_url: "https://erp.example.com/hook",
    webhook_secret: "default-secret",
    endpoints: [{ id: "a1", name: "Plant 2", webhook_url: "https://erp2.example.com/hook", webhook_secret: "endpoint-secret" }],
  };

  it("seals every secret, leaves the URLs readable and round-trips", async () => {
    const { sealIntegrationPush, unsealIntegrationPush } = await import("./webhookPush");
    const sealed = sealIntegrationPush(plain);
    expect(JSON.stringify(sealed)).not.toContain("default-secret");
    expect(JSON.stringify(sealed)).not.toContain("endpoint-secret");
    expect(sealed.webhook_url).toBe(plain.webhook_url);
    expect(sealed.endpoints?.[0].webhook_url).toBe(plain.endpoints[0].webhook_url);
    expect(sealIntegrationPush(sealed)).toEqual(sealed);
    expect(unsealIntegrationPush(sealed)).toEqual(plain);
  });

  it("an admin's tenant object carries the real secret, a member's carries none and no api_key", async () => {
    const { sealIntegrationPush } = await import("./webhookPush");
    const { redactTenantForRole } = await import("./tenant");
    const tenant = {
      id: "t1", api_key: "legacy-full-access-key",
      config: { integration_push: sealIntegrationPush(plain), account_360: { sources: [{ id: "s", title: "S", url: "https://x.example.com", auth_value: "sealed-or-not" }] } },
    } as never;
    const admin = redactTenantForRole(tenant, "admin") as { config: { integration_push: { webhook_secret: string } } };
    expect(admin.config.integration_push.webhook_secret).toBe("default-secret");
    const member = redactTenantForRole(tenant, "member") as { api_key: unknown; config: { integration_push: Record<string, unknown>; account_360: { sources: Record<string, unknown>[] } } };
    expect(member.api_key).toBeNull();
    expect(member.config.integration_push).toEqual({ webhook_url: plain.webhook_url });
    expect(member.config.account_360.sources[0]).not.toHaveProperty("auth_value");
  }, 60_000); // the first import of the tenant module compiles the data layer
});
