import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeDb } from "@/lib/marketing/testFakeDb";
import { saveTechnicianProfile, technicianSaveBody } from "@/lib/technicianProfile";

// "Edit profile" used to toast "Profile saved" from a timer and never call the server.

const state = vi.hoisted(() => ({ db: null as unknown, logged: [] as Record<string, unknown>[] }));

vi.mock("@/lib/supabase-server", () => ({
  requireTenantUser: async () => ({ supabase: state.db, tenantId: "t1" }),
  getAuthUser: async () => ({ id: "u1", email: "u@x.example" }),
}));
vi.mock("@/lib/changeLog", async () => {
  const real = await vi.importActual<typeof import("@/lib/changeLog")>("@/lib/changeLog");
  return { ...real, logChange: async (_s: unknown, e: Record<string, unknown>) => { state.logged.push(e); } };
});

import { NextRequest } from "next/server";
import { PATCH } from "./route";

const patch = (id: string, body: unknown) => PATCH(
  new NextRequest(new URL(`http://internal.invalid/api/technicians/${id}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ id }) },
);

function seed() {
  const db = fakeDb({
    technicians: [
      { id: "tech1", tenant_id: "t1", name: "Ramesh", phone: null, email: null, skills: null, base_location: null, max_visits_per_day: 3, status: "active", certifications: [], cert_expiry: {} },
      { id: "techX", tenant_id: "other", name: "Intruder", phone: null, status: "active" },
    ],
    technician_leaves: [
      { id: "l1", tenant_id: "t1", technician_id: "tech1", from_date: "2026-11-01", to_date: "2026-11-03", reason: "sick", notes: null },
      { id: "l2", tenant_id: "t1", technician_id: "tech1", from_date: "2026-12-01", to_date: "2026-12-02", reason: "vacation", notes: null },
    ],
  });
  state.db = db.client;
  return db;
}

beforeEach(() => { state.logged = []; });

describe("PATCH /api/technicians/[id]", () => {
  it("saves the profile fields, certifications and leave schedule, and logs the change", async () => {
    const db = seed();
    const res = await patch("tech1", {
      name: "Ramesh Kumar", phone: "+91 1", status: "on_leave", max_visits_per_day: 4, skills: "HT rewinding",
      certifications: [{ name: "HV License", expiry: "2027-01-01" }],
      leaves: [
        { id: "l1", from_date: "2026-11-01", to_date: "2026-11-04", reason: "sick", notes: "flu" },
        { from_date: "2027-01-10", to_date: "2027-01-12", reason: "training" },
      ],
    });
    expect(res.status).toBe(200);
    expect(db.tables.technicians[0]).toMatchObject({ name: "Ramesh Kumar", phone: "+91 1", status: "on_leave", max_visits_per_day: 4, certifications: ["HV License"], cert_expiry: { "HV License": "2027-01-01" } });
    const leaves = db.tables.technician_leaves;
    expect(leaves.find((l) => l.id === "l2")).toBeUndefined(); // removed in the form
    expect(leaves.find((l) => l.id === "l1")).toMatchObject({ to_date: "2026-11-04", notes: "flu" });
    expect(leaves.find((l) => l.reason === "training")).toMatchObject({ tenant_id: "t1", technician_id: "tech1" });
    expect(state.logged).toHaveLength(1);
    expect(state.logged[0]).toMatchObject({ tenantId: "t1", objectType: "technicians", objectId: "tech1", action: "update" });
    const body = await res.json();
    expect(body.leaves).toHaveLength(2);
  });

  it("never touches another tenant's technician", async () => {
    const db = seed();
    const res = await patch("techX", { name: "Hacked" });
    expect(res.status).toBe(404);
    expect(db.tables.technicians.find((t) => t.id === "techX")).toMatchObject({ name: "Intruder" });
  });

  it("refuses an empty name, a bad status and an inverted leave", async () => {
    seed();
    expect((await patch("tech1", { name: "  " })).status).toBe(400);
    expect((await patch("tech1", { status: "gone" })).status).toBe(422);
    expect((await patch("tech1", { leaves: [{ from_date: "2026-11-05", to_date: "2026-11-01", reason: "sick" }] })).status).toBe(422);
  });
});

describe("saveTechnicianProfile (the Edit profile screen)", () => {
  const input = {
    name: "Ramesh", phone: "", email: "", base_location: "", max_visits_per_day: 3, status: "active", skills: "",
    certs: [{ name: "", expiry: "" }, { name: "HV", expiry: "2027-01-01" }],
    leaves: [{ id: "leave-new-1", from_date: "2026-11-01", to_date: "2026-11-02", reason: "sick", notes: "" }, { id: "real-uuid", from_date: "2026-12-01", to_date: "2026-12-02", reason: "other", notes: "" }],
  };

  it("calls the server with PATCH and resolves only after a 2xx", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ leaves: [] }), { status: 200 }); }) as unknown as typeof fetch;
    await saveTechnicianProfile("tech1", input, ok);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/technicians/tech1");
    expect(calls[0].init.method).toBe("PATCH");
  });

  it("throws the server's message on a failure, so the screen shows an error and no success toast", async () => {
    const bad = (async () => new Response(JSON.stringify({ error: "Name is required" }), { status: 400 })) as unknown as typeof fetch;
    await expect(saveTechnicianProfile("tech1", input, bad)).rejects.toThrow("Name is required");
  });

  it("sends stored leave ids only and drops blank certifications", () => {
    const b = technicianSaveBody(input);
    expect(b.certifications).toEqual([{ name: "HV", expiry: "2027-01-01" }]);
    expect(b.leaves[0]).not.toHaveProperty("id");
    expect(b.leaves[1]).toHaveProperty("id", "real-uuid");
  });
});
