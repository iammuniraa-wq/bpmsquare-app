import { beforeEach, describe, expect, it, vi } from "vitest";

// getAnalyticsDataLive reads the tender desk data only for a workspace with the platform-admin flag gcc_tender, once, for the caller's own
// tenant, and never lets a failure there take the dashboard down.

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  tenant: { features: {} as Record<string, boolean>, config: {} } as { features: Record<string, boolean>; config: Record<string, unknown> } | null,
  tenderCalls: [] as string[],
  tenderImpl: async (_id: string): Promise<unknown> => ({ marker: "tender data" }),
}));

/** A query builder that answers every chain with no rows. */
function anyQuery(): unknown {
  const handler: ProxyHandler<() => void> = {
    get: (_t, prop) => {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
      return () => new Proxy(() => {}, handler);
    },
    apply: () => new Proxy(() => {}, handler),
  };
  return new Proxy(() => {}, handler);
}

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => ({ from: () => anyQuery(), rpc: () => anyQuery() }),
  getAuthUser: async () => state.user,
  resolveViewerTenantId: async () => "tenant-a",
}));
vi.mock("@/lib/tenant", () => ({ getTenant: async () => state.tenant }));
vi.mock("@/lib/tenderDesk/server", () => ({ getTenderDeskData: (id: string) => { state.tenderCalls.push(id); return state.tenderImpl(id); } }));
vi.mock("@/lib/data/news", () => ({ getAccountNews: async () => [], getBusinessNews: async () => [], DEFAULT_NEWS_TOPICS: [] }));
vi.mock("@/lib/inbox/analytics", () => ({ getInboxAnalytics: async () => ({ newThisWeek: 0, unhandled: 0, medianFirstReplyMinutes: null }), NO_INBOX_ANALYTICS: { newThisWeek: 0, unhandled: 0, medianFirstReplyMinutes: null } }));
vi.mock("@/lib/wfm/server", () => ({ getWfmLiveBoardSnapshot: async () => ({ sites: [] }), requireWfm: async () => ({}) }));

import { getAnalyticsDataLive } from "./live";

beforeEach(() => {
  state.user = { id: "u1" };
  state.tenant = { features: {}, config: {} };
  state.tenderCalls = [];
  state.tenderImpl = async () => ({ marker: "tender data" });
});

describe("AnalyticsData.tender", () => {
  it("is the tender desk data for a workspace with gcc_tender, read once, for the caller's own tenant", async () => {
    state.tenant = { features: { gcc_tender: true }, config: {} };
    const a = await getAnalyticsDataLive();
    expect(a.tender).toEqual({ marker: "tender data" });
    expect(state.tenderCalls).toEqual(["tenant-a"]);
  });

  it("is null and never read for a workspace without the flag", async () => {
    for (const features of [{}, { gcc_tender: false }, { pipeline: true }] as Record<string, boolean>[]) {
      state.tenant = { features, config: {} };
      state.tenderCalls = [];
      const a = await getAnalyticsDataLive();
      expect(a.tender).toBeNull();
      expect(state.tenderCalls).toEqual([]);
    }
  });

  it("is left out when the caller does not draw it (the Reports page)", async () => {
    state.tenant = { features: { gcc_tender: true }, config: {} };
    const a = await getAnalyticsDataLive({ tender: false });
    expect(a.tender).toBeNull();
    expect(state.tenderCalls).toEqual([]);
  });

  it("is null, with the rest of the analytics intact, when reading it fails", async () => {
    state.tenant = { features: { gcc_tender: true }, config: {} };
    state.tenderImpl = async () => { throw new Error("boom"); };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await getAnalyticsDataLive();
    expect(a.tender).toBeNull();
    expect(a.totals.accounts).toBe(0);
    expect(Array.isArray(a.quotesByStatus)).toBe(true);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("is null without a signed-in tenant", async () => {
    state.user = null;
    state.tenant = { features: { gcc_tender: true }, config: {} };
    const a = await getAnalyticsDataLive();
    expect(a.tender).toBeNull();
    expect(state.tenderCalls).toEqual([]);
  });
});
