import { describe, it, expect, vi, beforeEach } from "vitest";

const auth = vi.hoisted(() => ({ role: "admin" as "admin" | "member", tenantId: "t1", db: null as unknown }));
vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: vi.fn(() => auth.db),
  requireTenantUser: vi.fn(async () => ({ tenantId: auth.tenantId, userId: "admin1", role: auth.role, supabase: auth.db })),
}));

import { fakeDb } from "./testFakeDb";
import { tipTextProblems } from "@/lib/infoTip";
import { applyLimits, limitsSettingsOf, limitsTimezoneOf, sanitizeLimits } from "./limits";
import { LIMITS_TIPS } from "./limitsTips";
import { limitsOf } from "./journeys/safety";
import { weeklyCapOf } from "./whatsapp/rules";
import { GET, PUT } from "@/app/api/settings/marketing-limits/route";

const ON = { marketing: true, marketing_scoring: true, journeys: true, whatsapp_marketing: true };

describe("limits: reading", () => {
  it("shows the defaults the senders really use when nothing is stored", () => {
    expect(limitsSettingsOf({})).toEqual({ quiet_from_hour: 20, quiet_to_hour: 8, off_weekdays: [5], max_per_day: 1, whatsapp_weekly_cap: 1 });
  });

  it("reads what is stored, the same way the journey runner and the WhatsApp send do", () => {
    const config = { marketing: { journey_limits: { max_per_day: 3, quiet_from_hour: 22, quiet_to_hour: 6, off_weekdays: [5, 6] } }, whatsapp: { weekly_cap: 4 } };
    const s = limitsSettingsOf(config);
    expect(s).toEqual({ quiet_from_hour: 22, quiet_to_hour: 6, off_weekdays: [5, 6], max_per_day: 3, whatsapp_weekly_cap: 4 });
    expect(limitsOf(config).maxPerDay).toBe(s.max_per_day);
    expect(weeklyCapOf(config)).toBe(s.whatsapp_weekly_cap);
  });

  it("names the timezone and where it comes from", () => {
    expect(limitsTimezoneOf({ wfm: { timezone: "Asia/Riyadh" } as never })).toEqual({ timezone: "Asia/Riyadh", source: "workforce" });
    expect(limitsTimezoneOf({})).toMatchObject({ source: "default" });
  });
});

describe("limits: validation", () => {
  const now = limitsSettingsOf({});

  it("keeps what is stored for anything that is not sent", () => {
    const r = sanitizeLimits({ max_per_day: 2 }, now);
    expect(r).toEqual({ ok: true, value: { ...now, max_per_day: 2 } });
  });

  it("accepts a full, valid form", () => {
    const r = sanitizeLimits({ quiet_from_hour: 21, quiet_to_hour: 7, off_weekdays: [6, 5, 5], max_per_day: 2, whatsapp_weekly_cap: 3 }, now);
    expect(r).toEqual({ ok: true, value: { quiet_from_hour: 21, quiet_to_hour: 7, off_weekdays: [5, 6], max_per_day: 2, whatsapp_weekly_cap: 3 } });
  });

  it.each([
    [{ quiet_from_hour: 24 }], [{ quiet_from_hour: -1 }], [{ quiet_to_hour: 7.5 }], [{ quiet_to_hour: "late" }],
    [{ off_weekdays: [7] }], [{ off_weekdays: "5" }], [{ off_weekdays: [0, 1, 2, 3, 4, 5, 6] }],
    [{ max_per_day: 0 }], [{ max_per_day: 11 }], [{ whatsapp_weekly_cap: 0 }], [{ whatsapp_weekly_cap: 21 }],
  ])("refuses %j instead of clamping it", (bad) => {
    expect(sanitizeLimits(bad, now).ok).toBe(false);
  });

  it("refuses a body that is not an object", () => {
    expect(sanitizeLimits(null, now).ok).toBe(false);
  });

  it("writes the limits and keeps every other key beside them", () => {
    const config = { marketing: { topics: [], journey_limits: { trouble_case_days: 45, blast_radius: 50 } }, whatsapp: { redirect_number: "+966500000000" } } as never;
    const next = applyLimits(config, { quiet_from_hour: 22, quiet_to_hour: 6, off_weekdays: [5], max_per_day: 2, whatsapp_weekly_cap: 3 }) as never as {
      marketing: { topics: unknown[]; journey_limits: Record<string, unknown> }; whatsapp: Record<string, unknown>;
    };
    expect(next.marketing.journey_limits).toEqual({ trouble_case_days: 45, blast_radius: 50, quiet_from_hour: 22, quiet_to_hour: 6, off_weekdays: [5], max_per_day: 2 });
    expect(next.whatsapp).toEqual({ redirect_number: "+966500000000", weekly_cap: 3 });
    expect(next.marketing.topics).toEqual([]);
  });
});

describe("limits: every explanation fits the InfoTip limit", () => {
  it.each(Object.entries(LIMITS_TIPS))("%s", (_k, text) => expect(tipTextProblems(text)).toEqual([]));
});

describe("the limits route", () => {
  const put = (body: unknown) => PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }) as never);
  let db: ReturnType<typeof fakeDb>;
  const config = () => db.tables.tenants.find((t) => t.id === "t1")!.config as Record<string, never>;

  beforeEach(() => {
    auth.role = "admin"; auth.tenantId = "t1";
    db = fakeDb({
      tenants: [
        { id: "t1", features: ON, config: { marketing: { journey_limits: { blast_radius: 50 } }, whatsapp: { redirect_number: "+1" } } },
        { id: "t2", features: ON, config: {} },
      ],
    });
    auth.db = db.client;
  });

  it("is for admins only", async () => {
    auth.role = "member";
    expect((await GET()).status).toBe(403);
    expect((await put({ max_per_day: 2 })).status).toBe(403);
  });

  it("is not there for a workspace without the marketing_scoring program", async () => {
    db.tables.tenants[0].features = { marketing: true };
    expect((await GET()).status).toBe(404);
    expect((await put({ max_per_day: 2 })).status).toBe(404);
  });

  it("returns the values, the timezone chip and which modules have limits to show", async () => {
    const j = await (await GET()).json() as Record<string, unknown>;
    expect(j).toMatchObject({ settings: { max_per_day: 1, quiet_from_hour: 20 }, source: "default", modules: { journeys: true, whatsapp: true } });
    db.tables.tenants[0].features = { marketing: true, marketing_scoring: true, journeys: true };
    expect((await (await GET()).json() as { modules: unknown }).modules).toEqual({ journeys: true, whatsapp: false });
  });

  it("saves into this workspace only, keeps the rest of its config and ignores a tenant named in the body", async () => {
    const r = await put({ max_per_day: 3, quiet_from_hour: 22, whatsapp_weekly_cap: 2, tenant_id: "t2", tenantId: "t2" });
    expect(r.status).toBe(200);
    expect(config().marketing).toMatchObject({ journey_limits: { blast_radius: 50, max_per_day: 3, quiet_from_hour: 22 } });
    expect(config().whatsapp).toEqual({ redirect_number: "+1", weekly_cap: 2 });
    expect(db.tables.tenants.find((t) => t.id === "t2")!.config).toEqual({});
    const updates = db.queries.filter((q) => q.table === "tenants" && q.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].filters.id).toBe("t1");
  });

  it("refuses a bad value with a message and saves nothing", async () => {
    const before = JSON.stringify(config());
    const r = await put({ max_per_day: 99 });
    expect(r.status).toBe(400);
    expect((await r.json() as { error: string }).error).toMatch(/between 1 and 10/);
    expect(JSON.stringify(config())).toBe(before);
  });

  it("writes one change-history row naming what moved, and none when nothing moved", async () => {
    await put({ max_per_day: 3 });
    const log = db.tables.change_log ?? [];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ tenant_id: "t1", object_type: "marketing_settings", action: "update" });
    expect((log[0].changes as { field: string }[]).map((c) => c.field)).toEqual(["max_per_day"]);
    await put({ max_per_day: 3 });
    expect(db.tables.change_log).toHaveLength(1);
  });

  it("takes the tenant from the session, never from the request", async () => {
    auth.tenantId = "t2";
    await put({ max_per_day: 5 });
    expect(config().marketing).toMatchObject({ journey_limits: { blast_radius: 50 } });
    expect((config().marketing as unknown as { journey_limits: Record<string, unknown> }).journey_limits.max_per_day).toBeUndefined();
    expect((db.tables.tenants.find((t) => t.id === "t2")!.config as { marketing: { journey_limits: { max_per_day: number } } }).marketing.journey_limits.max_per_day).toBe(5);
  });
});
