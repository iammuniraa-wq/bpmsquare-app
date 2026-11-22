import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/marketing/testFakeDb";

// One logo per workspace: the Company screen's logo drives the letterhead (company_info.logo_url) AND the app sidebar,
// sign-in page and prints (tenants.logo_url). It must only touch tenants.logo_url when the logo really changed.

const state = vi.hoisted(() => ({ db: null as unknown, role: "admin" }));
vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ tenantId: "t1", role: state.role }),
  createAdminSupabase: () => state.db,
}));

import { NextRequest } from "next/server";
import { PATCH } from "./route";

const patch = (body: Record<string, unknown>) =>
  PATCH(new NextRequest(new URL("http://internal.invalid/api/settings/company-info"), { method: "PATCH", body: JSON.stringify(body) }));

function seed(logo: string | null, infoLogo?: string) {
  const db = fakeDb({ tenants: [{ id: "t1", logo_url: logo, company_info: infoLogo === undefined ? {} : { logo_url: infoLogo } }] });
  state.db = db.client;
  return db.tables.tenants[0];
}

beforeEach(() => { state.role = "admin"; });

describe("PATCH /api/settings/company-info (logo)", () => {
  it("a new logo updates the letterhead logo and the app logo together", async () => {
    const row = seed(null);
    const res = await patch({ logo_url: "https://s.example/pcbs.png" });
    expect(res.status).toBe(200);
    expect(row.logo_url).toBe("https://s.example/pcbs.png");
    expect(row.company_info).toMatchObject({ logo_url: "https://s.example/pcbs.png" });
  });

  it("saving other details with the logo unchanged leaves a separately set app logo alone", async () => {
    const row = seed("https://s.example/sidebar.png", "https://s.example/letterhead.png");
    await patch({ logo_url: "https://s.example/letterhead.png", address: "Riyadh" });
    expect(row.logo_url).toBe("https://s.example/sidebar.png");
    expect(row.company_info).toMatchObject({ address: "Riyadh" });
  });

  it("a save that does not mention the logo never touches the app logo", async () => {
    const row = seed("https://s.example/sidebar.png");
    await patch({ address: "Riyadh" });
    expect(row.logo_url).toBe("https://s.example/sidebar.png");
  });

  it("removing the logo clears the app logo too", async () => {
    const row = seed("https://s.example/a.png", "https://s.example/a.png");
    await patch({ logo_url: "" });
    expect(row.logo_url).toBeNull();
  });

  it("is admin only", async () => {
    state.role = "member";
    const row = seed(null);
    const res = await patch({ logo_url: "https://s.example/x.png" });
    expect(res.status).toBe(403);
    expect(row.logo_url).toBeNull();
  });
});
