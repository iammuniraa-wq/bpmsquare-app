import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: vi.fn(), canViewWorkcenter: () => true, canEditWorkcenter: () => true, canCreateWorkcenter: () => true }));
vi.mock("@/lib/changeLog", () => ({ logChange: vi.fn(), diffForLog: vi.fn() }));
vi.mock("@/lib/events/emitters", () => ({ emitEmailHandled: vi.fn() }));

import { createOptionsFor } from "./detail";
import { linkHref, LINK_ACCESS, LINK_TABLE } from "./links";
import { CREATE_LABEL, CREATE_TO_OBJECT, CREATE_TYPES, DEFAULT_ACTIONS, OBJECT_LABEL } from "./types";

// "Create deal" from an email (GCC tender deals, slice 1): the sixth create type, offered ONLY when the platform-admin
// flag gcc_tender is on. With it off the menu is the five it always was.

type Ctx = Parameters<typeof createOptionsFor>[0];
const ctx = (features: Record<string, boolean>): Ctx => ({ features, perms: { unrestricted: true, grants: new Map() } }) as unknown as Ctx;
const channel = (default_action: string) => ({ default_action }) as unknown as Parameters<typeof createOptionsFor>[1];

const STANDARD = { standard_quotes: true, wfm_projects: true, cases: true, estimator: true, leads: true, pipeline: true };

describe("Create from this email: the Deal type", () => {
  it("is a create type with a label, an object and a destination", () => {
    expect(CREATE_TYPES).toContain("deal");
    expect(CREATE_LABEL.deal).toBe("Deal");
    expect(CREATE_TO_OBJECT.deal).toBe("opportunities");
    expect(OBJECT_LABEL.opportunities).toBe("Deal");
    expect(LINK_TABLE.opportunities).toBe("opportunities");
    expect(linkHref("opportunities", "abc")).toBe("/pipeline/abc");
    expect(DEFAULT_ACTIONS).toContain("deal");
  });

  it("is not listed at all without the flag: the menu is exactly the five it was", () => {
    const off = createOptionsFor(ctx({ ...STANDARD }), channel("none"));
    expect(off.map((o) => o.type)).toEqual(["quote", "project", "case", "estimate", "lead"]);
    const offFalse = createOptionsFor(ctx({ ...STANDARD, gcc_tender: false }), channel("deal"));
    expect(offFalse.map((o) => o.type)).toEqual(["quote", "project", "case", "estimate", "lead"]);
  });

  it("is listed and available with the flag and the Pipeline", () => {
    const on = createOptionsFor(ctx({ ...STANDARD, gcc_tender: true }), channel("none"));
    expect(on.find((o) => o.type === "deal")).toEqual({ type: "deal", available: true, reason: null });
  });

  it("a channel whose favourite is Deal lists it first", () => {
    const on = createOptionsFor(ctx({ ...STANDARD, gcc_tender: true }), channel("deal"));
    expect(on[0].type).toBe("deal");
  });

  it("needs the Pipeline as well as the flag", () => {
    const noPipeline = createOptionsFor(ctx({ ...STANDARD, pipeline: false, gcc_tender: true }), channel("none"));
    expect(noPipeline.find((o) => o.type === "deal")).toMatchObject({ available: false });
    expect(LINK_ACCESS.opportunities).toMatchObject({ feature: "gcc_tender", also: "pipeline", workcenter: "pipeline" });
  });
});
