import { describe, expect, it } from "vitest";
import { buildSummary, sanitizeRemoteSummary } from "./summary";

// A tenants table that holds exactly the things the summary must never carry.
const TENANT = {
  id: "t1", slug: "acme", name: "Acme", status: "active", plan: "enterprise", custom_domain: "acme.example", is_demo: false,
  created_at: "2026-01-01T00:00:00Z", features: { pipeline: true, rfq: false, gcc_tender: true },
  api_key: "SECRET-API-KEY", config: { integration_push: { webhook_secret: "SEALED" } }, owner_email: "someone@example.com",
};

function fakeAdmin(opts: { tenantsError?: boolean } = {}) {
  const tenantQueries: string[] = [];
  const admin = {
    from: (table: string) => {
      if (table === "tenants") {
        return {
          select: (cols: string) => {
            tenantQueries.push(cols);
            return { order: async () => (opts.tenantsError ? { data: null, error: { message: "boom" } } : { data: [TENANT], error: null }) };
          },
        };
      }
      return {
        select: () => ({
          order: () => ({ range: async () => ({ data: [{ tenant_id: "t1" }, { tenant_id: "t1" }, { tenant_id: "t1" }], error: null }) }),
        }),
      };
    },
  };
  return { admin: admin as never, tenantQueries };
}

describe("buildSummary", () => {
  it("projects whitelisted fields only: no api_key, no config, no e-mail", async () => {
    const { admin, tenantQueries } = fakeAdmin();
    const s = await buildSummary(admin, { INSTANCE_SLUG: "kamco", VERCEL_GIT_COMMIT_SHA: "0123456789abcdef", VERCEL_REGION: "fra1" } as never, new Date("2026-11-22T10:00:00Z"));
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/api_key|SECRET-API-KEY|"config"|webhook_secret|SEALED|@/);
    expect(tenantQueries[0]).not.toMatch(/api_key|config/);
    expect(s.tenants[0]).toEqual({
      id: "t1", slug: "acme", name: "Acme", status: "active", plan: "enterprise", custom_domain: "acme.example", is_demo: false,
      created_at: "2026-01-01T00:00:00Z", user_count: 3, flags_on: ["gcc_tender", "pipeline"],
    });
    expect(s.instance).toEqual({ slug: "kamco", name: "kamco", build: "01234567", region: "fra1", now: "2026-11-22T10:00:00.000Z" });
  });

  it("reports configuration as booleans, never the keys", async () => {
    const { admin } = fakeAdmin();
    const s = await buildSummary(admin, { ANTHROPIC_API_KEY: "sk-secret", RESEND_API_KEY: "" } as never);
    expect(s.health).toEqual({ db: true, ai_configured: true, email_configured: false });
    expect(JSON.stringify(s)).not.toContain("sk-secret");
  });

  it("a failing tenants read is db:false with no tenants, not a throw", async () => {
    const { admin } = fakeAdmin({ tenantsError: true });
    const s = await buildSummary(admin, {} as never);
    expect(s.health.db).toBe(false);
    expect(s.tenants).toEqual([]);
  });
});

describe("sanitizeRemoteSummary", () => {
  it("rebuilds the shape and drops anything extra a remote instance sends", () => {
    const out = sanitizeRemoteSummary({
      instance: { slug: "kamco", name: "KAMCO", build: "abc", region: null, now: "2026-11-22T10:00:00Z", secret: "x" },
      tenants: [{ ...TENANT, user_count: 2, flags_on: ["pipeline", 7] }, { nope: true }],
      health: { db: true, ai_configured: false, email_configured: true, extra: 1 },
      leaked: "x",
    });
    expect(out).not.toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/SECRET|secret|leaked|api_key|owner_email|@/);
    expect(out!.tenants).toHaveLength(1);
    expect(out!.tenants[0].flags_on).toEqual(["pipeline"]);
  });

  it("refuses something that is not a summary", () => {
    expect(sanitizeRemoteSummary(null)).toBeNull();
    expect(sanitizeRemoteSummary({ instance: {}, tenants: "x", health: {} })).toBeNull();
  });
});
