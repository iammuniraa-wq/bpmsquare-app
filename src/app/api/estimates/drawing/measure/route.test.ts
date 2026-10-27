import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MemoryDb } from "@/lib/inbox/testing/memoryDb";
import { CH_OPEN, CH_OTHER_TENANT, CH_TEAM, ENV_KEY, ROLE_SALES, T1, T2, world } from "@/lib/inbox/testing/fixtures";
import { dxfFile, rectLines } from "@/lib/estimator/drawing/testing/dxfFixtures";

process.env.FIELD_ENCRYPTION_KEY = ENV_KEY;

const state = vi.hoisted(() => ({
  db: null as unknown,
  tenantId: "11111111-1111-4111-8111-111111111111",
  viewer: { isAdmin: false, roleIds: [] as string[] },
  estimatesOwned: true,
  inboxOwned: true,
}));

vi.mock("@/lib/supabase-server", () => ({ createAdminSupabase: vi.fn(), requireTenantUser: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: vi.fn(), canViewWorkcenter: () => true, canEditWorkcenter: () => true, canCreateWorkcenter: () => true, canDeleteWorkcenter: () => true }));

vi.mock("@/lib/estimator/server", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/estimator/server")>();
  return {
    ...orig,
    estimatorAccess: vi.fn(async () => {
      if (!state.estimatesOwned) throw { status: 404, message: "Not found" };
      return { tenantId: state.tenantId };
    }),
  };
});
vi.mock("@/lib/inbox/server", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/inbox/server")>();
  return {
    ...orig,
    inboxAccess: vi.fn(async () => {
      if (!state.inboxOwned) throw { status: 404, message: "Not found" };
      return { admin: state.db, tenantId: state.tenantId, viewer: state.viewer };
    }),
  };
});

import { encrypt } from "@/lib/encryption";
import { POST } from "./route";

let db: MemoryDb;
const E_OPEN = "11111111-0000-4000-8000-000000000001";
const E_TEAM = "11111111-0000-4000-8000-000000000002";
const E_FOREIGN = "22222222-0000-4000-8000-000000000003";
const A_DXF = "11111111-0000-4000-8000-0000000000a1";
const A_PDF = "11111111-0000-4000-8000-0000000000a2";
const A_TEAM = "11111111-0000-4000-8000-0000000000a3";
const A_FOREIGN = "22222222-0000-4000-8000-0000000000a4";
const A_BADPATH = "11111111-0000-4000-8000-0000000000a5";

function msg(id: string, channelId: string, tenantId: string) {
  db.rows("inbound_emails").push({
    id, tenant_id: tenantId, channel_id: channelId, direction: "in", from_address: "c@customer.test", from_name: "C", subject: "Fence",
    snippet: encrypt("s"), body_text: encrypt("b"), status: "new", received_at: "2026-10-24T08:00:00Z", expires_at: "2027-01-22T00:00:00Z",
    thread_key: `t-${id}`, to_addresses: [], message_id: `${id}@x`,
  });
}
async function file(id: string, emailId: string, tenantId: string, name: string, content: string | Buffer, over: Record<string, unknown> = {}) {
  const path = `${tenantId}/inbox/${emailId}/${name}`;
  await db.storage.from("inbox-attachments").upload(path, Buffer.from(content));
  db.rows("inbound_email_attachments").push({ id, tenant_id: tenantId, email_id: emailId, file_name: name, storage_path: path, mime_type: "application/octet-stream", size_bytes: Buffer.byteLength(content), ...over });
}
const call = (body: unknown) => POST(new NextRequest("http://x/api/estimates/drawing/measure", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }));

beforeEach(async () => {
  db = world();
  state.db = db;
  state.tenantId = T1;
  state.viewer = { isAdmin: false, roleIds: [] };
  state.estimatesOwned = true;
  state.inboxOwned = true;
  msg(E_OPEN, CH_OPEN, T1);
  msg(E_TEAM, CH_TEAM, T1);
  msg(E_FOREIGN, CH_OTHER_TENANT, T2);
  await file(A_DXF, E_OPEN, T1, "plan.dxf", dxfFile({ units: 4, layers: [{ name: "FENCE" }], entities: rectLines("FENCE", 10_000, 5_000) }));
  await file(A_PDF, E_OPEN, T1, "plan.pdf", "%PDF-1.4");
  await file(A_TEAM, E_TEAM, T1, "team.dxf", dxfFile({ units: 6, entities: rectLines("A", 1, 1) }));
  await file(A_FOREIGN, E_FOREIGN, T2, "other.dxf", dxfFile({ units: 6, entities: rectLines("SECRET", 1, 1) }));
  // A row whose stored path points into another workspace's folder.
  await file(A_BADPATH, E_OPEN, T1, "evil.dxf", dxfFile({ units: 6, entities: rectLines("A", 1, 1) }), { storage_path: `${T2}/inbox/${E_FOREIGN}/other.dxf` });
});

describe("POST /api/estimates/drawing/measure", () => {
  it("measures a DXF attachment of a message the person can see", async () => {
    const res = await call({ email_id: E_OPEN, attachment_id: A_DXF });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.file).toBe("plan.dxf");
    expect(json.unit).toMatchObject({ code: 4, factor: 0.001 });
    expect(json.layers.rows.find((r: { layer: string }) => r.layer === "FENCE").lengthM).toBeCloseTo(30, 9);
    expect(json.model.entities).toHaveLength(4);
    expect(json.counts).toMatchObject({ entities: 4, capped: false });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("re-scales with a chosen unit and rejects a nonsense one", async () => {
    const ok = await (await call({ email_id: E_OPEN, attachment_id: A_DXF, unit_factor: 0.01 })).json();
    expect(ok.layers.rows[0].lengthM).toBeCloseTo(300, 9);
    expect((await call({ email_id: E_OPEN, attachment_id: A_DXF, unit_factor: -1 })).status).toBe(422);
    expect((await call({ email_id: E_OPEN, attachment_id: A_DXF, unit_factor: "big" })).status).toBe(422);
  });

  it("another workspace's attachment is a 404, with or without its message id", async () => {
    expect((await call({ email_id: E_FOREIGN, attachment_id: A_FOREIGN })).status).toBe(404);
    expect((await call({ email_id: E_OPEN, attachment_id: A_FOREIGN })).status).toBe(404);
    const other = await call({ email_id: E_FOREIGN, attachment_id: A_FOREIGN });
    expect(JSON.stringify(await other.json())).not.toContain("SECRET");
  });

  it("an attachment filed under a different message than the one named is a 404", async () => {
    expect((await call({ email_id: E_TEAM, attachment_id: A_DXF })).status).toBe(404);
  });

  it("a message on a channel the person is not on is a 404; a member of the team, or an admin, can read it", async () => {
    expect((await call({ email_id: E_TEAM, attachment_id: A_TEAM })).status).toBe(404);
    state.viewer = { isAdmin: false, roleIds: [ROLE_SALES] };
    expect((await call({ email_id: E_TEAM, attachment_id: A_TEAM })).status).toBe(200);
    state.viewer = { isAdmin: true, roleIds: [] };
    expect((await call({ email_id: E_TEAM, attachment_id: A_TEAM })).status).toBe(200);
  });

  it("never reads a stored path outside the session workspace's folder", async () => {
    expect((await call({ email_id: E_OPEN, attachment_id: A_BADPATH })).status).toBe(404);
  });

  it("refuses anything that is not a DXF, and ids that are not ids", async () => {
    const pdf = await call({ email_id: E_OPEN, attachment_id: A_PDF });
    expect(pdf.status).toBe(422);
    expect((await pdf.json()).error).toMatch(/Only DXF/);
    expect((await call({ email_id: "x", attachment_id: A_DXF })).status).toBe(404);
    expect((await call({ email_id: E_OPEN })).status).toBe(404);
    expect((await call(null)).status).toBe(404);
  });

  it("says so when the file is not a readable drawing", async () => {
    await file("11111111-0000-4000-8000-0000000000b1", E_OPEN, T1, "junk.dxf", "not a drawing");
    const r = await call({ email_id: E_OPEN, attachment_id: "11111111-0000-4000-8000-0000000000b1" });
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(/DXF/);
  });

  it("needs the Estimates module and the Inbox module (404 when the workspace owns either not)", async () => {
    state.estimatesOwned = false;
    expect((await call({ email_id: E_OPEN, attachment_id: A_DXF })).status).toBe(404);
    state.estimatesOwned = true;
    state.inboxOwned = false;
    expect((await call({ email_id: E_OPEN, attachment_id: A_DXF })).status).toBe(404);
  });
});
