import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  ctx: { tenantId: "t1", employee: { id: "viewer" }, isSupervisor: true } as Record<string, unknown>,
  scope: { unrestricted: true, employeeIds: [] as string[] },
  events: [] as Row[],
  sites: [] as Row[],
  siteQueries: [] as [string, unknown][][],
  geocodeCalls: [] as [number, number][],
  geocodeConfigured: true,
  geocodeFails: false,
  retention: 60,
}));

const EMP = "emp-1";
const SITE = "site-1";

function builder(table: string) {
  const filters: [string, unknown][] = [];
  const rows = (): Row[] => {
    if (table === "wfm_presence_events") return state.events;
    if (table === "wfm_sites") {
      state.siteQueries.push(filters);
      return state.sites.filter((r) => filters.every(([k, v]) => r[k] === v));
    }
    return [];
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: (k: string, v: unknown) => { filters.push([k, v]); return b; },
    is: () => b,
    gte: () => b,
    lt: () => b,
    order: () => b,
    update: () => b,
    maybeSingle: async () => ({
      data: table === "employees" ? { id: EMP, first_name: "Asha", last_name: "Rao", employee_code: "E1", shift_id: null } : null,
    }),
    then: (resolve: (v: { data: Row[] }) => unknown) => Promise.resolve({ data: rows() }).then(resolve),
  });
  return b;
}

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({
    from: (t: string) => builder(t),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed/selfie.jpg" } }) }) },
  }),
}));
vi.mock("@/lib/wfm/server", () => ({
  requireWfm: async () => state.ctx,
  getWfmConfig: async () => ({ timezone: "UTC", selfie_retention_days: state.retention }),
}));
vi.mock("@/lib/wfm/scope", () => ({ resolveWfmScope: async () => state.scope }));
vi.mock("@/lib/wfm/geocode", () => ({
  geocodingConfigured: () => state.geocodeConfigured,
  reverseGeocode: async (lat: number, lng: number) => {
    state.geocodeCalls.push([lat, lng]);
    if (state.geocodeFails) throw new Error("boom");
    return { status: "ok", address: "Plot 4, Industrial Area" };
  },
}));

import { GET } from "./route";

const ev = (id: string, extra: Row = {}): Row => ({
  id, kind: "check_in", ts: "2026-09-10T04:00:00Z", source: "kiosk_face", site_id: SITE,
  geo_lat: null, geo_lng: null, geo_accuracy_m: null, within_geofence: true, selfie_path: "t1/x.jpg",
  geo_address: null, flags: null, ...extra,
});

const call = (employeeId: string = EMP) =>
  GET({ nextUrl: new URL(`http://x/api/wfm/presence?employee_id=${employeeId}&date=2026-09-10`) } as never);

beforeEach(() => {
  state.ctx = { tenantId: "t1", employee: { id: "viewer" }, isSupervisor: true };
  state.scope = { unrestricted: true, employeeIds: [] };
  state.events = [ev("e1"), ev("e2", { kind: "check_out", ts: "2026-09-10T12:00:00Z" })];
  state.sites = [{ id: SITE, tenant_id: "t1", name: "Plant 1", lat: 12.9716, lng: 77.5946 }];
  state.siteQueries = [];
  state.geocodeCalls = [];
  state.geocodeConfigured = true;
  state.geocodeFails = false;
  state.retention = 60;
});

describe("GET /api/wfm/presence: site pin for punches with no GPS fix", () => {
  it("returns the site pin and its address for a kiosk punch, to a supervisor in scope", async () => {
    state.scope = { unrestricted: false, employeeIds: [EMP] };
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.events[0].site_pin).toEqual({ lat: 12.9716, lng: 77.5946, name: "Plant 1", address: "Plot 4, Industrial Area" });
    expect(body.selfie_retention_days).toBe(60);
  });

  it("looks the address up once per distinct site, not once per punch", async () => {
    await call();
    expect(state.geocodeCalls).toHaveLength(1);
    expect(state.geocodeCalls[0]).toEqual([12.9716, 77.5946]);
  });

  it("reads sites only with the tenant filter", async () => {
    await call();
    expect(state.siteQueries.length).toBeGreaterThan(0);
    for (const q of state.siteQueries) expect(q).toContainEqual(["tenant_id", "t1"]);
  });

  it("a site in another tenant is never returned", async () => {
    state.sites = [{ id: SITE, tenant_id: "t2", name: "Their plant", lat: 1, lng: 2 }];
    const body = await (await call()).json();
    expect(body.events[0].site_pin).toBeNull();
    expect(state.geocodeCalls).toHaveLength(0);
  });

  it("falls back to a null address when the geocoder fails or is not configured", async () => {
    state.geocodeFails = true;
    expect((await (await call()).json()).events[0].site_pin.address).toBeNull();
    state.geocodeFails = false;
    state.geocodeConfigured = false;
    state.geocodeCalls = [];
    const body = await (await call()).json();
    expect(body.events[0].site_pin).toMatchObject({ name: "Plant 1", address: null });
    expect(state.geocodeCalls).toHaveLength(0);
  });

  it("gives no pin to a punch that has a GPS fix, and does not geocode the site for it", async () => {
    state.events = [ev("e1", { source: "web_selfie", geo_lat: 12.1, geo_lng: 77.1, geo_address: "Known" })];
    const body = await (await call()).json();
    expect(body.events[0].site_pin).toBeNull();
    expect(state.geocodeCalls).toHaveLength(0);
  });

  it("refuses a supervisor outside the employee's scope before reading any site", async () => {
    state.scope = { unrestricted: false, employeeIds: ["someone-else"] };
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.siteQueries).toHaveLength(0);
    expect(state.geocodeCalls).toHaveLength(0);
  });

  it("refuses a non-supervisor asking for someone else's punches before reading any site", async () => {
    state.ctx = { tenantId: "t1", employee: { id: "viewer" }, isSupervisor: false };
    const res = await call();
    expect(res.status).toBe(403);
    expect(state.siteQueries).toHaveLength(0);
  });
});
