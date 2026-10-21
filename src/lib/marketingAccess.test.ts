import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PermissionSet, EffectiveGrant, WorkcenterKey } from "./permissions";

const requireTenantUser = vi.fn();
vi.mock("@/lib/supabase-server", () => ({ requireTenantUser: (...a: unknown[]) => requireTenantUser(...a) }));

const resolvePermissions = vi.fn();
vi.mock("@/lib/permissions", async (orig) => ({
  ...(await orig<typeof import("./permissions")>()),
  resolvePermissions: (...a: unknown[]) => resolvePermissions(...a),
}));

// Resolves any select/eq/order chain to an empty list, so a request that gets past the guard completes.
const emptyQuery: Record<string, unknown> = { then: (r: (v: unknown) => unknown) => r({ data: [], error: null }) };
for (const m of ["select", "eq", "order"]) emptyQuery[m] = () => emptyQuery;
const supabase = { from: () => emptyQuery };

const grant = (workcenter: WorkcenterKey, canView: boolean, canEdit: boolean): EffectiveGrant =>
  ({ workcenter, canView, canEdit, canCreate: canEdit, canDelete: canEdit });
const scoped = (...gs: EffectiveGrant[]): PermissionSet => ({ unrestricted: false, grants: new Map(gs.map((g) => [g.workcenter, g])) });
const unrestricted: PermissionSet = { unrestricted: true, grants: new Map() };

describe("marketingAccessAllowed", () => {
  it("never restricts admins or members with no Business Role", async () => {
    const { marketingAccessAllowed } = await import("./marketingAccess");
    expect(marketingAccessAllowed(unrestricted, ["marketing"], "edit")).toBe(true);
    expect(marketingAccessAllowed(unrestricted, ["marketing_segments"], "view")).toBe(true);
  });

  it("denies a scoped role that lacks the workcenter, however it is phrased", async () => {
    const { marketingAccessAllowed } = await import("./marketingAccess");
    const p = scoped(grant("accounts", true, true));
    expect(marketingAccessAllowed(p, ["marketing"], "view")).toBe(false);
    expect(marketingAccessAllowed(p, ["marketing_segments"], "edit")).toBe(false);
  });

  it("separates view from edit", async () => {
    const { marketingAccessAllowed } = await import("./marketingAccess");
    const p = scoped(grant("marketing", true, false));
    expect(marketingAccessAllowed(p, ["marketing"], "view")).toBe(true);
    expect(marketingAccessAllowed(p, ["marketing"], "edit")).toBe(false);
  });

  it("keeps Campaigns and Segmentation independent, but lets either satisfy a shared read", async () => {
    const { marketingAccessAllowed } = await import("./marketingAccess");
    const p = scoped(grant("marketing", true, true));
    expect(marketingAccessAllowed(p, ["marketing_segments"], "view")).toBe(false);
    expect(marketingAccessAllowed(p, ["marketing", "marketing_segments"], "view")).toBe(true);
  });
});

describe("marketing API routes honour the workcenter grants", () => {
  // The first import of a route module compiles the data layer behind it, which
  // takes longer than the 5 s default on a loaded machine; the guard itself is fast.
  vi.setConfig({ testTimeout: 60_000 });
  beforeEach(() => {
    vi.resetModules();
    requireTenantUser.mockReset();
    resolvePermissions.mockReset();
    requireTenantUser.mockResolvedValue({ supabase, tenantId: "t1", userId: "u1", role: "member" });
  });

  const status = async (res: Promise<Response | undefined | void>) => (await res as Response).status;
  const idParams = { params: Promise.resolve({ id: "x" }) };
  const req = () => ({ json: () => Promise.resolve({ name: "n" }) }) as never;

  it("returns 403 before touching data when the role has no Campaigns grant", async () => {
    resolvePermissions.mockResolvedValue(scoped(grant("marketing_segments", true, true)));
    const campaigns = await import("@/app/api/marketing/campaigns/route");
    const one = await import("@/app/api/marketing/campaigns/[id]/route");
    const send = await import("@/app/api/marketing/campaigns/[id]/send/route");
    expect(await status(campaigns.GET())).toBe(403);
    expect(await status(campaigns.POST(req()))).toBe(403);
    expect(await status(one.GET(req(), idParams))).toBe(403);
    expect(await status(one.PATCH(req(), idParams))).toBe(403);
    expect(await status(one.DELETE(req(), idParams))).toBe(403);
    expect(await status(send.POST(req(), idParams))).toBe(403);
  });

  it("returns 403 for segment writes without Segmentation edit, even with Campaigns edit", async () => {
    resolvePermissions.mockResolvedValue(scoped(grant("marketing", true, true), grant("marketing_segments", true, false)));
    const groups = await import("@/app/api/marketing/target-groups/route");
    const one = await import("@/app/api/marketing/target-groups/[id]/route");
    expect(await status(groups.POST(req()))).toBe(403);
    expect(await status(one.PATCH(req(), idParams))).toBe(403);
    expect(await status(one.DELETE(req(), idParams))).toBe(403);
  });

  it("returns 403 for the recipient preview and group list with neither grant", async () => {
    resolvePermissions.mockResolvedValue(scoped(grant("accounts", true, true)));
    const groups = await import("@/app/api/marketing/target-groups/route");
    const preview = await import("@/app/api/marketing/recipients-preview/route");
    expect(await status(groups.GET())).toBe(403);
    expect(await status(preview.POST(req()))).toBe(403);
  });

  it("passes the guard for a view-only Campaigns role on reads, but not writes", async () => {
    resolvePermissions.mockResolvedValue(scoped(grant("marketing", true, false)));
    const campaigns = await import("@/app/api/marketing/campaigns/route");
    expect(await status(campaigns.POST(req()))).toBe(403);
    expect(await status(campaigns.GET())).not.toBe(403);
  });
});
