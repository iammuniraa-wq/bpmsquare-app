import { describe, it, expect, vi, beforeEach } from "vitest";

// The id line is part of the Integration middleware: a workspace without the flag gets nothing and
// the slot runs no query at all (the tenant comes from the request-cached getTenant()).

const getTenant = vi.fn();
const externalRefsForOne = vi.fn();
const createAdminSupabase = vi.fn(() => ({ marker: "admin" }));

vi.mock("@/lib/tenant", () => ({ getTenant: () => getTenant() }));
vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: () => createAdminSupabase() }));
vi.mock("@/lib/connectors/externalRef", () => ({ externalRefsForOne: (...a: unknown[]) => externalRefsForOne(...a) }));

import ExternalRecordSlot from "./ExternalRecordSlot";
import ExternalRecordLine from "./ExternalRecordLine";

beforeEach(() => {
  getTenant.mockReset();
  externalRefsForOne.mockReset();
  createAdminSupabase.mockClear();
});

describe("ExternalRecordSlot", () => {
  it("renders nothing and runs no query when the workspace does not have integration_middleware", async () => {
    for (const features of [{}, { integration_middleware: false }, null]) {
      getTenant.mockResolvedValue({ id: "t1", features });
      expect(await ExternalRecordSlot({ objectType: "accounts", objectId: "a1" })).toBeNull();
    }
    expect(createAdminSupabase).not.toHaveBeenCalled();
    expect(externalRefsForOne).not.toHaveBeenCalled();
  });

  it("renders nothing when there is no tenant", async () => {
    getTenant.mockResolvedValue(null);
    expect(await ExternalRecordSlot({ objectType: "accounts", objectId: "a1" })).toBeNull();
    expect(externalRefsForOne).not.toHaveBeenCalled();
  });

  it("with the flag on, loads this record's links for this tenant only and draws the line", async () => {
    getTenant.mockResolvedValue({ id: "t1", features: { integration_middleware: true } });
    const refs = [{ connectorId: "dynamics365", system: "Dynamics 365", objectLabel: "Quote", readable: "QUO-1", deepLink: null, direction: "push", title: "x" }];
    externalRefsForOne.mockResolvedValue(refs);
    const el = await ExternalRecordSlot({ objectType: "standard_quotes", objectId: "q1" });
    expect(externalRefsForOne).toHaveBeenCalledWith({ marker: "admin" }, "t1", "standard_quotes", "q1");
    expect(el).toMatchObject({ type: ExternalRecordLine, props: { refs } });
  });
});
