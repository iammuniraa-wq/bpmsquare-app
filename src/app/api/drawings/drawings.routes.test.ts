import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { PDF, T1, T2, U_ADMIN, U_APPR, U_OTHER, U_PREP, id, makeHarness, sha256, type Harness } from "@/lib/drawings/testing/harness";

// The drawing register's routes end to end on an in-memory workspace: tenant isolation, the field allowlists, that NO write is ever made with a
// member's own session, who may release, the second-person rule, the immutability of a released revision, file handling and the schedule
// loader. The release function itself is the database's; migrations.test.ts holds its SQL to the same steps the harness runs.

const h = vi.hoisted(() => ({ current: null as unknown as Harness }));

vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => h.current.admin(),
  getAuthUser: async () => h.current.state.user,
  requireTenantUser: async () => ({ tenantId: h.current.state.tenantId, userId: h.current.state.user.id, role: h.current.state.role, supabase: h.current.session() }),
}));
vi.mock("@/lib/tenant", () => ({
  tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!h.current.state.features[key],
  getTenant: async () => ({ id: h.current.state.tenantId, features: h.current.state.features, config: {} }),
}));
vi.mock("@/lib/permissions", () => ({
  resolvePermissions: async () => ({}),
  canViewWorkcenter: () => h.current.state.view,
  canEditWorkcenter: () => h.current.state.edit,
  canCreateWorkcenter: () => h.current.state.edit,
}));
vi.mock("@/lib/objectFeatures", () => ({
  assertObjectFeature: async (_t: string, o: string) => (o.startsWith("drawing") && !h.current.state.features.drawing_register ? Response.json({ error: "Not found" }, { status: 404 }) : null),
  tenantOwnsObject: async () => true,
}));
vi.mock("@/lib/changeLog", () => ({
  diffForLog: (_o: string, before: Record<string, unknown>, patch: Record<string, unknown>) => Object.entries(patch).filter(([k, v]) => JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null)).map(([field, to]) => ({ field, from: before[field] ?? null, to })),
  logChange: async (_c: unknown, p: Harness["state"]["changes"][number]) => { h.current.state.changes.push(p); },
  logChangeBatch: async (_c: unknown, rows: Harness["state"]["changes"]) => { h.current.state.changes.push(...rows); },
}));
vi.mock("@/lib/sales/opportunityServer", () => ({ listMembersForPicker: async () => [{ user_id: U_PREP, name: "Priya Preparer", email: "p@t1.test" }, { user_id: U_APPR, name: "Anil Approver", email: "a@t1.test" }] }));
vi.mock("@/lib/drawings/storage", () => ({
  DRAWING_BUCKET_NAME: "drawing-files",
  readHead: async (_a: unknown, path: string) => {
    const o = h.current.db.storageObjects.get(`drawing-files/${path}`);
    return o ? { ok: true, head: new Uint8Array(o.content.subarray(0, 4096)), size: o.content.length } : { ok: false };
  },
  hashOfObject: async (_a: unknown, path: string) => {
    const o = h.current.db.storageObjects.get(`drawing-files/${path}`);
    return o ? { ok: true, sha256: createHash("sha256").update(o.content).digest("hex") } : { ok: false };
  },
}));
vi.mock("@/lib/import/server", async (orig) => ({ ...(await orig<typeof import("@/lib/import/server")>()), fetchAllRows: async () => [] }));
vi.mock("@/lib/fieldConfig", () => ({
  getEffectiveFieldConfig: async () => ({ sections: [{ fields: [
    { field_key: "drawing_no", label: "Drawing number", widget: "text", hidden: false, required: false, kind: "standard" },
    { field_key: "title", label: "Title", widget: "text", hidden: false, required: false, kind: "standard" },
    { field_key: "external_no", label: "External number", widget: "text", hidden: false, required: false, kind: "standard" },
    { field_key: "released_rev", label: "Released revision", widget: "text", hidden: false, required: false, kind: "standard", exportOnly: true },
  ] }] }),
  getSalesConfig: async () => ({ product_categories: [] }),
}));

import { GET as listGet, POST as createPost } from "./route";
import { GET as oneGet, PATCH as onePatch, DELETE as oneDelete } from "./[id]/route";
import { GET as revsGet, POST as revsPost } from "./[id]/revisions/route";
import { PATCH as revPatch, DELETE as revDelete } from "./[id]/revisions/[revId]/route";
import { POST as uploadPost } from "./[id]/revisions/[revId]/upload/route";
import { POST as finalizePost } from "./[id]/revisions/[revId]/finalize/route";
import { GET as fileGet } from "./[id]/revisions/[revId]/file/route";
import { POST as submitPost } from "./[id]/revisions/[revId]/submit/route";
import { POST as returnPost } from "./[id]/revisions/[revId]/return/route";
import { POST as releasePost } from "./[id]/revisions/[revId]/release/route";
import { GET as elementsGet, POST as elementsPost } from "./[id]/revisions/[revId]/elements/route";
import { GET as compareGet } from "./[id]/compare/route";
import { GET as typesGet, POST as typesPost } from "../settings/drawing-types/route";
import { PATCH as typePatch, DELETE as typeDelete } from "../settings/drawing-types/[id]/route";
import { POST as importPost } from "../import/drawings/route";
import { POST as exportPost } from "../export/drawings/route";
import { POST as updatePost } from "../update/drawings/route";

const json = (method: string, body?: unknown, url = "http://internal.invalid/x") =>
  new NextRequest(new URL(url), { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const j = async (res: Response) => (await res.json().catch(() => ({}))) as Record<string, any>;

const as = (user: string, role: "admin" | "member" = "member") => { h.current.state.user = { id: user, email: `${user}@t1.test` }; h.current.state.role = role; };

async function makeDrawing(body: Record<string, unknown> = {}) {
  const res = await createPost(json("POST", { drawing_no: "PRJ1-ARC-001", title: "Ground floor slab", ...body }));
  return { res, body: await j(res) };
}

/** A draft revision that has its file attached through the real upload + finalize steps. */
async function withFile(drawingId: string, revId: string, name = "plan.pdf", content: Buffer = PDF) {
  const t = h.current.state.tenantId;
  const path = `${t}/${drawingId}/${revId}/${name}`;
  h.current.db.storageObjects.set(`drawing-files/${path}`, { content });
  return finalizePost(json("POST", { name, sha256: sha256(content) }), ctx({ id: drawingId, revId }));
}

async function submitted(drawingBody: Record<string, unknown> = {}) {
  const { body: d } = await makeDrawing(drawingBody);
  await withFile(d.id, d.revision.id);
  const sub = await submitPost(json("POST"), ctx({ id: d.id, revId: d.revision.id }));
  return { d, sub, drawingId: d.id as string, revId: d.revision.id as string };
}

beforeEach(() => {
  h.current = makeHarness();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the module is hidden unless the workspace has it", () => {
  it("every route answers 404 without the flag, as if it did not exist", async () => {
    h.current.state.features.drawing_register = false;
    expect((await listGet(json("GET") as NextRequest)).status).toBe(404);
    expect((await createPost(json("POST", { drawing_no: "A", title: "B" }))).status).toBe(404);
    expect((await oneGet(json("GET"), ctx({ id: id(500) }))).status).toBe(404);
    expect((await typesGet()).status).toBe(404);
    expect((await importPost(json("POST", { rows: [{ rowNum: 1, values: { drawing_no: "A", title: "B" } }] }))).status).toBe(404);
    expect((await exportPost(json("POST", {}))).status).toBe(404);
    expect(h.current.rows("drawings")).toHaveLength(0);
  });
  it("a person who may not open Engineering gets 404 too", async () => {
    h.current.state.view = false;
    expect((await listGet(json("GET") as NextRequest)).status).toBe(404);
  });
});

describe("making a drawing", () => {
  it("creates the drawing and its first revision as a draft, with an ID, the default type and a change entry", async () => {
    const { res, body } = await makeDrawing({ external_no: "C-77" });
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ ref: "DWG-0001", drawing_no: "PRJ1-ARC-001", title: "Ground floor slab", external_no: "C-77", tenant_id: T1, revision: { rev_label: "A", rev_no: 0, status: "draft" } });
    const type = h.current.rows("drawing_types")[0];
    expect(type).toMatchObject({ name: "Drawing", rev_scheme: "letters", second_person: true });
    expect(body.type_id).toBe(type.id);
    expect(h.current.state.changes.map((c) => `${c.objectType}:${c.action}`)).toEqual(["drawings:create"]);
    expect(h.current.state.memberWrites).toEqual([]);
  });
  it("the next drawing gets the next ID, and a number is unique in the workspace whatever its case", async () => {
    await makeDrawing();
    const second = await makeDrawing({ drawing_no: "PRJ1-ARC-002" });
    expect(second.body.ref).toBe("DWG-0002");
    const dup = await makeDrawing({ drawing_no: "prj1-arc-001" });
    expect(dup.res.status).toBe(409);
    expect(h.current.rows("drawings")).toHaveLength(2);
  });
  it("needs a number and a title, and refuses odd characters", async () => {
    expect((await makeDrawing({ drawing_no: "" })).res.status).toBe(422);
    expect((await makeDrawing({ title: " " })).res.status).toBe(422);
    expect((await makeDrawing({ drawing_no: "a/b" })).res.status).toBe(422);
  });
  it("holds a number to the type's numbering pattern", async () => {
    h.current.rows("drawing_types").push({ id: id(60), tenant_id: T1, name: "Shop drawing", numbering_pattern: "{project}-{discipline}-{seq3}", rev_scheme: "numbers", approver_ids: [], second_person: true, required_fields: [], feeds: [], active: true, sort_order: 0 });
    const bad = await makeDrawing({ type_id: id(60), drawing_no: "nonsense" });
    expect(bad.res.status).toBe(422);
    const good = await makeDrawing({ type_id: id(60), drawing_no: "P1-STR-007" });
    expect(good.res.status).toBe(201);
    expect(good.body.revision.rev_label).toBe("0");
  });
  it("verifies every foreign id against the caller's own workspace", async () => {
    h.current.rows("opportunities").push({ id: id(70), tenant_id: T1, ref: "OPP-1", title: "Own tender" }, { id: id(71), tenant_id: T2, ref: "OPP-9", title: "Their tender" });
    h.current.rows("contract_projects").push({ id: id(72), tenant_id: T2, ref: "CPR-9", name: "Their project" });
    h.current.rows("drawing_types").push({ id: id(73), tenant_id: T2, name: "Their type", rev_scheme: "letters", approver_ids: [], second_person: true, required_fields: [], feeds: [], active: true, sort_order: 0 });
    expect((await makeDrawing({ opportunity_id: id(71) })).res.status).toBe(422);
    expect((await makeDrawing({ project_id: id(72) })).res.status).toBe(422);
    expect((await makeDrawing({ type_id: id(73) })).res.status).toBe(422);
    expect((await makeDrawing({ opportunity_id: "not-a-uuid" })).res.status).toBe(422);
    expect((await makeDrawing({ opportunity_id: id(70) })).res.status).toBe(201);
    expect(h.current.rows("drawings")).toHaveLength(1);
  });
  it("a building must belong to the tender the drawing is filed under", async () => {
    h.current.rows("opportunities").push({ id: id(70), tenant_id: T1, title: "A" }, { id: id(74), tenant_id: T1, title: "B" });
    h.current.rows("tender_wbs_items").push({ id: id(75), tenant_id: T1, opportunity_id: id(74), code: "1", name: "Block B" }, { id: id(76), tenant_id: T2, opportunity_id: id(70), code: "1", name: "Foreign" });
    expect((await makeDrawing({ opportunity_id: id(70), wbs_item_id: id(75) })).res.status).toBe(422);
    expect((await makeDrawing({ opportunity_id: id(70), wbs_item_id: id(76) })).res.status).toBe(422);
    expect((await makeDrawing({ opportunity_id: id(74), wbs_item_id: id(75) })).res.status).toBe(201);
  });
  it("only custom fields come through custom_data, and nothing in the body can set a status or a tenant", async () => {
    const { body } = await makeDrawing({ custom_data: { cf_grade: "C40", is_admin: true }, tenant_id: T2, current_rev_id: id(99), archived_at: "2020-01-01", status: "released" });
    expect(body.custom_data).toEqual({ cf_grade: "C40" });
    expect(body.tenant_id).toBe(T1);
    expect(body.current_rev_id ?? null).toBeNull();
    expect(body.archived_at ?? null).toBeNull();
  });
  it("a person who can only view cannot create", async () => {
    h.current.state.edit = false;
    expect((await makeDrawing()).res.status).toBe(403);
    expect(h.current.rows("drawings")).toHaveLength(0);
  });
});

describe("one workspace never reaches another's drawing", () => {
  const foreign = () => {
    h.current.rows("drawings").push({ id: id(200), tenant_id: T2, ref: "DWG-0001", drawing_no: "THEIRS-1", title: "Theirs", type_id: null, current_rev_id: null, custom_data: {}, archived_at: null, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" });
    h.current.rows("drawing_revisions").push({ id: id(201), tenant_id: T2, drawing_id: id(200), rev_no: 0, rev_label: "A", status: "draft", file_path: `${T2}/${id(200)}/${id(201)}/x.pdf`, file_name: "x.pdf", source: "upload", change_summary: {}, created_at: "2026-11-01T00:00:00Z" });
  };
  it("reads, edits, deletes and every revision route answer 404", async () => {
    foreign();
    const p = ctx({ id: id(200) });
    const r = ctx({ id: id(200), revId: id(201) });
    expect((await oneGet(json("GET"), p)).status).toBe(404);
    expect((await onePatch(json("PATCH", { title: "mine now" }), p)).status).toBe(404);
    expect((await oneDelete(json("DELETE"), p)).status).toBe(404);
    expect((await revsGet(json("GET"), p)).status).toBe(404);
    expect((await revsPost(json("POST", {}), p)).status).toBe(404);
    expect((await revPatch(json("PATCH", { notes: "x" }), r)).status).toBe(404);
    expect((await revDelete(json("DELETE"), r)).status).toBe(404);
    expect((await uploadPost(json("POST", { name: "a.pdf", size: 10 }), r)).status).toBe(404);
    expect((await finalizePost(json("POST", { name: "a.pdf", sha256: "0".repeat(64) }), r)).status).toBe(404);
    expect((await fileGet(json("GET"), r)).status).toBe(404);
    expect((await submitPost(json("POST"), r)).status).toBe(404);
    expect((await returnPost(json("POST", { reason: "x" }), r)).status).toBe(404);
    expect((await releasePost(json("POST", {}), r)).status).toBe(404);
    expect((await elementsGet(json("GET"), r)).status).toBe(404);
    expect((await compareGet(json("GET", undefined, "http://internal.invalid/x") as NextRequest, p)).status).toBe(404);
    expect(h.current.rows("drawings").find((d) => d.id === id(200))?.title).toBe("Theirs");
  });
  it("a revision id of another drawing of the SAME workspace does not open under this drawing", async () => {
    const a = (await makeDrawing({ drawing_no: "A-1" })).body;
    const b = (await makeDrawing({ drawing_no: "B-1" })).body;
    expect((await revPatch(json("PATCH", { notes: "x" }), ctx({ id: a.id, revId: b.revision.id }))).status).toBe(404);
  });
  it("the list shows only this workspace's drawings", async () => {
    foreign();
    await makeDrawing();
    const rows = await j(await listGet(json("GET") as NextRequest)) as unknown as Record<string, any>[];
    expect(Array.isArray(rows) && rows.map((r) => r.drawing_no)).toEqual(["PRJ1-ARC-001"]);
  });
});

describe("what a header edit may change", () => {
  it("an allowlist: the status, the current revision, the tenant and the ref are never taken from the body", async () => {
    const { body: d } = await makeDrawing();
    const res = await onePatch(json("PATCH", { title: "Renamed", ref: "DWG-9999", tenant_id: T2, current_rev_id: id(5), archived_at: "x", created_by: "x" }), ctx({ id: d.id }));
    expect(res.status).toBe(200);
    const row = h.current.rows("drawings")[0];
    expect(row).toMatchObject({ title: "Renamed", ref: "DWG-0001", tenant_id: T1 });
    expect(row.current_rev_id ?? null).toBeNull();
    expect(row.archived_at ?? null).toBeNull();
  });
  it("archives and un-archives, and logs a change", async () => {
    const { body: d } = await makeDrawing();
    await onePatch(json("PATCH", { archived: true }), ctx({ id: d.id }));
    expect(h.current.rows("drawings")[0].archived_at).toBeTruthy();
    await onePatch(json("PATCH", { archived: false }), ctx({ id: d.id }));
    expect(h.current.rows("drawings")[0].archived_at).toBeNull();
  });
  it("the number and the type are free while nothing was submitted, and fixed afterwards", async () => {
    const { body: d } = await makeDrawing();
    expect((await onePatch(json("PATCH", { drawing_no: "PRJ1-ARC-002" }), ctx({ id: d.id }))).status).toBe(200);
    await withFile(d.id, d.revision.id);
    await submitPost(json("POST"), ctx({ id: d.id, revId: d.revision.id }));
    const res = await onePatch(json("PATCH", { drawing_no: "CHANGED" }), ctx({ id: d.id }));
    expect(res.status).toBe(409);
    expect(h.current.rows("drawings")[0].drawing_no).toBe("PRJ1-ARC-002");
    // the same number sent again is not a change
    expect((await onePatch(json("PATCH", { drawing_no: "PRJ1-ARC-002", title: "ok" }), ctx({ id: d.id }))).status).toBe(200);
  });
  it("a foreign tender cannot be filed under", async () => {
    const { body: d } = await makeDrawing();
    h.current.rows("opportunities").push({ id: id(71), tenant_id: T2, title: "Theirs" });
    expect((await onePatch(json("PATCH", { opportunity_id: id(71) }), ctx({ id: d.id }))).status).toBe(422);
  });
  it("only a custom-field key is merged into custom_data", async () => {
    const { body: d } = await makeDrawing({ custom_data: { cf_a: "1" } });
    await onePatch(json("PATCH", { custom_data: { cf_b: "2", hack: "3" } }), ctx({ id: d.id }));
    expect(h.current.rows("drawings")[0].custom_data).toEqual({ cf_a: "1", cf_b: "2" });
  });
});

describe("revisions: one open at a time, labelled by the type", () => {
  it("a second revision cannot be started while one is open, and gets the next label after a release", async () => {
    const { body: d } = await makeDrawing();
    expect((await revsPost(json("POST", {}), ctx({ id: d.id }))).status).toBe(409);
    await withFile(d.id, d.revision.id);
    await submitPost(json("POST"), ctx({ id: d.id, revId: d.revision.id }));
    expect((await revsPost(json("POST", {}), ctx({ id: d.id }))).status).toBe(409);
    as(U_APPR);
    h.current.rows("drawing_types")[0].approver_ids = [U_APPR];
    expect((await releasePost(json("POST", {}), ctx({ id: d.id, revId: d.revision.id }))).status).toBe(200);
    as(U_PREP);
    const next = await revsPost(json("POST", { notes: "after the consultant's comments" }), ctx({ id: d.id }));
    expect(next.status).toBe(201);
    expect(await j(next)).toMatchObject({ rev_label: "B", rev_no: 1, status: "draft", notes: "after the consultant's comments" });
  });
  it("a connector's version can arrive only once", async () => {
    const { body: d } = await makeDrawing();
    h.current.rows("drawing_revisions")[0].source_ref = "acc:v12";
    h.current.rows("drawing_revisions")[0].status = "released";
    h.current.rows("drawing_revisions")[0].file_path = null;
    const again = await revsPost(json("POST", { source: "acc", source_ref: "acc:v12" }), ctx({ id: d.id }));
    expect(again.status).toBe(409);
  });
  it("a hand-typed label must be new and printable", async () => {
    const { body: d } = await makeDrawing();
    h.current.rows("drawing_revisions")[0].status = "released";
    expect((await revsPost(json("POST", { rev_label: "A" }), ctx({ id: d.id }))).status).toBe(409);
    expect((await revsPost(json("POST", { rev_label: "bad label" }), ctx({ id: d.id }))).status).toBe(422);
    expect((await revsPost(json("POST", { rev_label: "P2" }), ctx({ id: d.id }))).status).toBe(201);
  });
});

describe("the file", () => {
  it("asks for a target only for an allowed type and size, on a draft, with the tenant folder from the route", async () => {
    const { body: d } = await makeDrawing();
    const ctxR = ctx({ id: d.id, revId: d.revision.id });
    const ok = await uploadPost(json("POST", { name: "plan.pdf", size: 1000, tenant_id: T2, path: "elsewhere/x.pdf" }), ctxR);
    expect(ok.status).toBe(200);
    expect((await j(ok)).path).toBe(`${T1}/${d.id}/${d.revision.id}/plan.pdf`);
    expect((await uploadPost(json("POST", { name: "plan.svg", size: 1000 }), ctxR)).status).toBe(422);
    expect((await uploadPost(json("POST", { name: "plan.html", size: 1000 }), ctxR)).status).toBe(422);
    expect((await uploadPost(json("POST", { name: "run.exe", size: 1000 }), ctxR)).status).toBe(422);
    expect((await uploadPost(json("POST", { name: "huge.pdf", size: 60 * 1024 * 1024 }), ctxR)).status).toBe(422);
  });
  it("finalize records what really arrived: the size from storage, the type from the bytes, the fingerprint", async () => {
    const { body: d } = await makeDrawing();
    const res = await withFile(d.id, d.revision.id, "Plan A.pdf");
    expect(res.status).toBe(200);
    expect(await j(res)).toMatchObject({ file_name: "Plan A.pdf", file_type: "application/pdf", file_size: PDF.length, file_sha256: sha256(PDF), file_path: `${T1}/${d.id}/${d.revision.id}/Plan A.pdf` });
  });
  it("refuses SVG or HTML content under an allowed name, and removes the object", async () => {
    const { body: d } = await makeDrawing();
    const bad = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    const res = await withFile(d.id, d.revision.id, "plan.csv", bad);
    expect(res.status).toBe(422);
    expect(h.current.db.storageObjects.has(`drawing-files/${T1}/${d.id}/${d.revision.id}/plan.csv`)).toBe(false);
    expect(h.current.rows("drawing_revisions")[0].file_path ?? null).toBeNull();
  });
  it("a name that is not a real PDF is refused, and a missing object says the upload did not arrive", async () => {
    const { body: d } = await makeDrawing();
    expect((await withFile(d.id, d.revision.id, "plan.pdf", Buffer.from("<html></html>"))).status).toBe(422);
    const missing = await finalizePost(json("POST", { name: "gone.pdf", sha256: "a".repeat(64) }), ctx({ id: d.id, revId: d.revision.id }));
    expect(missing.status).toBe(409);
    expect((await finalizePost(json("POST", { name: "x.pdf", sha256: "nothex" }), ctx({ id: d.id, revId: d.revision.id }))).status).toBe(422);
  });
  it("replacing a file removes the old object", async () => {
    const { body: d } = await makeDrawing();
    await withFile(d.id, d.revision.id, "one.pdf");
    await withFile(d.id, d.revision.id, "two.pdf", Buffer.from("%PDF-1.4 second"));
    expect(h.current.db.objectsIn("drawing-files")).toEqual([`${T1}/${d.id}/${d.revision.id}/two.pdf`]);
  });
  it("no file after the revision was submitted", async () => {
    const s = await submitted();
    const ctxR = ctx({ id: s.drawingId, revId: s.revId });
    expect((await uploadPost(json("POST", { name: "late.pdf", size: 10 }), ctxR)).status).toBe(409);
    expect((await withFile(s.drawingId, s.revId, "late.pdf")).status).toBe(409);
  });
  it("the download is a 303 to a signed link, and only for a file under this workspace's own folder", async () => {
    const { body: d } = await makeDrawing();
    await withFile(d.id, d.revision.id);
    const res = await fileGet(json("GET"), ctx({ id: d.id, revId: d.revision.id }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("https://signed.test/drawing-files/");
    expect(res.headers.get("location")).toContain("download=");
    // a stored path that points into another tenant's folder is never signed
    h.current.rows("drawing_revisions")[0].file_path = `${T2}/${id(9)}/${id(8)}/secret.pdf`;
    h.current.db.storageObjects.set(`drawing-files/${T2}/${id(9)}/${id(8)}/secret.pdf`, { content: PDF });
    expect((await fileGet(json("GET"), ctx({ id: d.id, revId: d.revision.id }))).status).toBe(404);
  });
});

describe("submitting for review", () => {
  it("needs a file or a schedule, and says what else is missing", async () => {
    const { body: d } = await makeDrawing();
    const res = await submitPost(json("POST"), ctx({ id: d.id, revId: d.revision.id }));
    expect(res.status).toBe(422);
    expect((await j(res)).problems.length).toBeGreaterThan(0);
  });
  it("moves a draft to in review and records who and when", async () => {
    const s = await submitted();
    expect(s.sub.status).toBe(200);
    expect(await j(s.sub)).toMatchObject({ status: "in_review", submitted_by: U_PREP });
    expect(h.current.rows("drawing_revisions")[0].submitted_at).toBeTruthy();
    const again = await submitPost(json("POST"), ctx({ id: s.drawingId, revId: s.revId }));
    expect(again.status).toBe(409);
  });
  it("the type's required fields hold it back", async () => {
    h.current.rows("drawing_types").push({ id: id(60), tenant_id: T1, name: "Tender drawing", numbering_pattern: null, rev_scheme: "letters", approver_ids: [], second_person: true, required_fields: ["external_no", "notes"], feeds: [], active: true, sort_order: 0 });
    const { body: d } = await makeDrawing({ type_id: id(60) });
    await withFile(d.id, d.revision.id);
    expect((await submitPost(json("POST"), ctx({ id: d.id, revId: d.revision.id }))).status).toBe(422);
    await onePatch(json("PATCH", { external_no: "C-1" }), ctx({ id: d.id }));
    await revPatch(json("PATCH", { notes: "issued for tender" }), ctx({ id: d.id, revId: d.revision.id }));
    expect((await submitPost(json("POST"), ctx({ id: d.id, revId: d.revision.id }))).status).toBe(200);
  });
  it("a viewer cannot submit", async () => {
    const { body: d } = await makeDrawing();
    await withFile(d.id, d.revision.id);
    h.current.state.edit = false;
    expect((await submitPost(json("POST"), ctx({ id: d.id, revId: d.revision.id }))).status).toBe(403);
  });
});

describe("who may release, and what a release does", () => {
  it("the person who submitted it cannot release it, even as an admin", async () => {
    const s = await submitted();
    as(U_PREP, "admin");
    const res = await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    expect(res.status).toBe(403);
    expect(h.current.rows("drawing_revisions")[0].status).toBe("in_review");
    expect(h.current.state.rpcCalls).toHaveLength(0);
  });
  it("a member who is not a named approver cannot, an approver can", async () => {
    const s = await submitted();
    h.current.rows("drawing_types")[0].approver_ids = [U_APPR];
    as(U_OTHER);
    expect((await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(403);
    as(U_ADMIN, "admin");
    expect((await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(403);
    as(U_APPR);
    const ok = await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    expect(ok.status).toBe(200);
    expect((await j(ok)).revision).toMatchObject({ status: "released", released_by: U_APPR });
    expect(h.current.rows("drawings")[0].current_rev_id).toBe(s.revId);
  });
  it("with no named approver, a workspace admin releases and an ordinary member does not", async () => {
    const s = await submitted();
    as(U_OTHER);
    expect((await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(403);
    as(U_ADMIN, "admin");
    expect((await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(200);
  });
  it("a viewer-only approver can still release: authority is the type's, not the module's edit grant", async () => {
    const s = await submitted();
    h.current.rows("drawing_types")[0].approver_ids = [U_APPR];
    as(U_APPR);
    h.current.state.edit = false;
    expect((await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(200);
  });
  it("releasing supersedes the previous release in one step and leaves exactly one released revision", async () => {
    const s = await submitted();
    as(U_ADMIN, "admin");
    await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    as(U_PREP);
    const b = await j(await revsPost(json("POST", {}), ctx({ id: s.drawingId })));
    await withFile(s.drawingId, b.id, "plan-b.pdf", Buffer.from("%PDF-1.7 b"));
    await submitPost(json("POST"), ctx({ id: s.drawingId, revId: b.id }));
    as(U_ADMIN, "admin");
    const rel = await releasePost(json("POST", { effective_from: "2026-12-01" }), ctx({ id: s.drawingId, revId: b.id }));
    expect(rel.status).toBe(200);
    expect((await j(rel)).superseded_id).toBe(s.revId);
    const revs = h.current.rows("drawing_revisions");
    expect(revs.filter((r) => r.status === "released").map((r) => r.rev_label)).toEqual(["B"]);
    expect(revs.find((r) => r.rev_label === "A")?.status).toBe("superseded");
    expect(h.current.rows("drawings")[0].current_rev_id).toBe(b.id);
    expect(h.current.rows("drawing_revisions").find((r) => r.id === b.id)?.supersedes_rev_id).toBe(s.revId);
    expect(h.current.state.changes.some((c) => c.changes?.some((x) => /Revision B released/.test(x.field)))).toBe(true);
    expect(h.current.state.memberWrites).toEqual([]);
  });
  it("only a revision in review can be released: a draft, a released and a superseded one cannot", async () => {
    const { body: d } = await makeDrawing();
    as(U_ADMIN, "admin");
    expect((await releasePost(json("POST", {}), ctx({ id: d.id, revId: d.revision.id }))).status).toBe(409);
  });
  it("a file that no longer matches its fingerprint cannot be released", async () => {
    const s = await submitted();
    const path = h.current.rows("drawing_revisions")[0].file_path as string;
    h.current.db.storageObjects.set(`drawing-files/${path}`, { content: Buffer.from("%PDF-1.7 TAMPERED") });
    as(U_ADMIN, "admin");
    const res = await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    expect(res.status).toBe(409);
    expect(h.current.rows("drawing_revisions")[0].status).toBe("in_review");
  });
  it("when the database function is not there yet the answer says a database update is needed", async () => {
    const s = await submitted();
    h.current.state.failRpc = { code: "42883", message: "function release_drawing_revision does not exist" };
    as(U_ADMIN, "admin");
    const res = await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    expect(res.status).toBe(503);
    expect(await j(res)).toMatchObject({ needsDatabaseUpdate: true });
  });
  it("the database's own second-person refusal comes back as 403 even if a route let it through", async () => {
    const s = await submitted();
    as(U_PREP, "admin");
    h.current.rows("drawing_types")[0].second_person = false;
    h.current.rows("drawing_types")[0].approver_ids = [U_PREP];
    h.current.rows("drawing_types")[0].second_person = true; // the type changed under the route's feet
    h.current.state.failRpc = { message: "The person who submitted a revision cannot release it" };
    const res = await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    expect(res.status).toBe(403);
  });
});

describe("returning to draft", () => {
  it("needs a reason, and only the submitter, a named approver or an admin may do it", async () => {
    const s = await submitted();
    h.current.rows("drawing_types")[0].approver_ids = [U_APPR];
    const c = ctx({ id: s.drawingId, revId: s.revId });
    as(U_OTHER);
    expect((await returnPost(json("POST", { reason: "no" }), c)).status).toBe(403);
    as(U_APPR);
    expect((await returnPost(json("POST", { reason: " " }), c)).status).toBe(422);
    const ok = await returnPost(json("POST", { reason: "Dimensions on the slab do not match the section" }), c);
    expect(ok.status).toBe(200);
    expect(await j(ok)).toMatchObject({ status: "draft", return_reason: "Dimensions on the slab do not match the section" });
  });
  it("the submitter can take it back, and it can be submitted again", async () => {
    const s = await submitted();
    expect((await returnPost(json("POST", { reason: "withdrawn, wrong file" }), ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(200);
    expect((await submitPost(json("POST"), ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(200);
  });
  it("only a revision in review can be returned", async () => {
    const { body: d } = await makeDrawing();
    expect((await returnPost(json("POST", { reason: "x" }), ctx({ id: d.id, revId: d.revision.id }))).status).toBe(409);
  });
});

describe("a revision that left draft is a record", () => {
  it("cannot be edited or deleted, and neither can its drawing", async () => {
    const s = await submitted();
    const c = ctx({ id: s.drawingId, revId: s.revId });
    expect((await revPatch(json("PATCH", { notes: "sneaky", rev_label: "Z" }), c)).status).toBe(409);
    expect((await revDelete(json("DELETE"), c)).status).toBe(409);
    expect((await oneDelete(json("DELETE"), ctx({ id: s.drawingId }))).status).toBe(409);
    expect(h.current.rows("drawing_revisions")).toHaveLength(1);
    expect(h.current.rows("drawing_revisions")[0].rev_label).toBe("A");
    // released: the same
    as(U_ADMIN, "admin");
    await releasePost(json("POST", {}), c);
    as(U_PREP);
    expect((await revPatch(json("PATCH", { notes: "sneaky" }), c)).status).toBe(409);
    expect((await revDelete(json("DELETE"), c)).status).toBe(409);
    expect((await oneDelete(json("DELETE"), ctx({ id: s.drawingId }))).status).toBe(409);
    expect(h.current.rows("drawings")).toHaveLength(1);
  });
  it("a draft that was never submitted can be deleted with its file; the first revision stays with its drawing", async () => {
    const s = await submitted();
    as(U_ADMIN, "admin");
    await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    as(U_PREP);
    const b = await j(await revsPost(json("POST", {}), ctx({ id: s.drawingId })));
    await withFile(s.drawingId, b.id, "b.pdf", Buffer.from("%PDF-1.7 b"));
    expect((await revDelete(json("DELETE"), ctx({ id: s.drawingId, revId: b.id }))).status).toBe(204);
    expect(h.current.db.objectsIn("drawing-files").some((o) => o.endsWith("b.pdf"))).toBe(false);
    expect(h.current.rows("drawing_revisions")).toHaveLength(1);
  });
  it("a drawing nobody submitted can be deleted with its files", async () => {
    const { body: d } = await makeDrawing();
    await withFile(d.id, d.revision.id);
    expect((await oneDelete(json("DELETE"), ctx({ id: d.id }))).status).toBe(204);
    expect(h.current.rows("drawings")).toHaveLength(0);
    expect(h.current.db.objectsIn("drawing-files")).toEqual([]);
  });
});

describe("a member's own session never writes", () => {
  it("a whole life of a drawing makes no write with the member session", async () => {
    const s = await submitted();
    as(U_ADMIN, "admin");
    await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    await onePatch(json("PATCH", { title: "x" }), ctx({ id: s.drawingId }));
    await typesPost(json("POST", { name: "Shop drawing" }));
    expect(h.current.state.memberWrites).toEqual([]);
  });
});

describe("drawing types in Settings", () => {
  it("an ordinary member can read the types but not write them", async () => {
    expect((await typesGet()).status).toBe(200);
    expect((await typesPost(json("POST", { name: "Shop drawing" }))).status).toBe(403);
    as(U_ADMIN, "admin");
    const made = await typesPost(json("POST", { name: "Shop drawing", numbering_pattern: "{project}-{seq3}", rev_scheme: "numbers", approver_ids: [U_APPR], feeds: ["handover"] }));
    expect(made.status).toBe(201);
    as(U_OTHER);
    expect((await typePatch(json("PATCH", { active: false }), ctx({ id: (await j(made)).id }))).status).toBe(403);
    expect((await typeDelete(json("DELETE"), ctx({ id: (await j(made)).id }))).status).toBe(403);
  });
  it("approvers must be members of THIS workspace", async () => {
    as(U_ADMIN, "admin");
    expect((await typesPost(json("POST", { name: "Bad", approver_ids: [id(999)] }))).status).toBe(422);
    const ok = await j(await typesPost(json("POST", { name: "Good", approver_ids: [U_APPR] })));
    expect((await typePatch(json("PATCH", { approver_ids: [id(998)] }), ctx({ id: ok.id }))).status).toBe(422);
  });
  it("another workspace's type is not reachable", async () => {
    h.current.rows("drawing_types").push({ id: id(300), tenant_id: T2, name: "Theirs", rev_scheme: "letters", approver_ids: [], second_person: true, required_fields: [], feeds: [], active: true, sort_order: 0 });
    as(U_ADMIN, "admin");
    expect((await typePatch(json("PATCH", { name: "Mine" }), ctx({ id: id(300) }))).status).toBe(404);
    expect((await typeDelete(json("DELETE"), ctx({ id: id(300) }))).status).toBe(404);
    expect(h.current.rows("drawing_types").find((t) => t.id === id(300))?.name).toBe("Theirs");
  });
  it("a type that drawings use cannot be deleted, only switched off", async () => {
    await makeDrawing();
    const type = h.current.rows("drawing_types")[0];
    as(U_ADMIN, "admin");
    expect((await typeDelete(json("DELETE"), ctx({ id: type.id as string }))).status).toBe(409);
    expect((await typePatch(json("PATCH", { active: false }), ctx({ id: type.id as string }))).status).toBe(200);
    as(U_PREP);
    expect((await makeDrawing({ drawing_no: "NEW-1", type_id: type.id })).res.status).toBe(422);
  });
  it("changing the approvers takes effect for a revision already in review", async () => {
    const s = await submitted();
    as(U_APPR);
    expect((await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(403);
    as(U_ADMIN, "admin");
    await typePatch(json("PATCH", { approver_ids: [U_APPR] }), ctx({ id: h.current.rows("drawing_types")[0].id as string }));
    as(U_APPR);
    expect((await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(200);
  });
});

async function scheduleForm(rows: string[][], name = "schedule.xlsx", extra: Record<string, string> = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("S");
  for (const r of rows) ws.addRow(r.map((c) => (c !== "" && !Number.isNaN(Number(c)) ? Number(c) : c)));
  const buf = name.endsWith(".csv") ? Buffer.from(rows.map((r) => r.join(",")).join("\n")) : Buffer.from(await wb.xlsx.writeBuffer());
  const form = new FormData();
  form.set("file", new File([new Uint8Array(buf)], name));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return { request: new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", body: form }), sha: sha256(buf) };
}
const SCHEDULE = [["Mark", "Type", "Building", "Count", "Volume (m3)", "Weight (t)"], ["WP-001", "Wall panel", "B1", "4", "2.5", "6.25"], ["WP-002", "Wall panel", "B1", "2", "3", "7.5"]];

describe("loading an element schedule (Route B)", () => {
  it("a preview reads the file and changes nothing", async () => {
    const { body: d } = await makeDrawing();
    const { request } = await scheduleForm(SCHEDULE, "schedule.xlsx", { mode: "preview" });
    const res = await elementsPost(request, ctx({ id: d.id, revId: d.revision.id }));
    expect(res.status).toBe(200);
    const out = await j(res);
    expect(out).toMatchObject({ count: 2, headers: ["Mark", "Type", "Building", "Count", "Volume (m3)", "Weight (t)"], map: { element_code: "Mark", qty: "Count" }, confirmUnits: [] });
    expect(h.current.rows("drawing_revision_elements")).toHaveLength(0);
  });
  it("a load replaces the elements of the draft and keeps where they came from", async () => {
    const { body: d } = await makeDrawing();
    const { request, sha } = await scheduleForm(SCHEDULE, "schedule.xlsx", { mode: "load" });
    const res = await elementsPost(request, ctx({ id: d.id, revId: d.revision.id }));
    expect(res.status).toBe(201);
    const els = h.current.rows("drawing_revision_elements");
    expect(els.map((e) => [e.element_code, e.qty, e.volume_m3, e.weight_t, e.tenant_id, e.revision_id])).toEqual([["WP-001", 4, 2.5, 6.25, T1, d.revision.id], ["WP-002", 2, 3, 7.5, T1, d.revision.id]]);
    expect(h.current.rows("drawing_revisions")[0].change_summary).toMatchObject({ elements: { source: "schedule", file_name: "schedule.xlsx", sha256: sha, rows: 2 } });
    // and a schedule alone is enough to submit (no file)
    expect((await submitPost(json("POST"), ctx({ id: d.id, revId: d.revision.id }))).status).toBe(200);
  });
  it("a unit the file does not state must be confirmed before it loads", async () => {
    const { body: d } = await makeDrawing();
    const rows = [["Mark", "Count", "Volume"], ["A", "1", "2"]];
    const first = await scheduleForm(rows, "s.csv", { mode: "load" });
    const refused = await elementsPost(first.request, ctx({ id: d.id, revId: d.revision.id }));
    expect(refused.status).toBe(422);
    expect((await j(refused)).confirmUnits).toEqual(["volume"]);
    expect(h.current.rows("drawing_revision_elements")).toHaveLength(0);
    const second = await scheduleForm(rows, "s.csv", { mode: "load", confirm_units: "true" });
    expect((await elementsPost(second.request, ctx({ id: d.id, revId: d.revision.id }))).status).toBe(201);
  });
  it("the same schedule cannot be loaded on two revisions of a drawing", async () => {
    const s = await submitted();
    as(U_ADMIN, "admin");
    await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    as(U_PREP);
    const b = await j(await revsPost(json("POST", {}), ctx({ id: s.drawingId })));
    // a CSV is byte-for-byte repeatable (a workbook carries a timestamp), so the same file really is the same fingerprint
    const csvRows = [["Mark", "Count", "Volume (m3)"], ["A1", "2", "1.5"], ["A2", "1", "2"]];
    expect((await elementsPost((await scheduleForm(csvRows, "s.csv", { mode: "load" })).request, ctx({ id: s.drawingId, revId: b.id }))).status).toBe(201);
    as(U_ADMIN, "admin");
    await withFile(s.drawingId, b.id, "b.pdf", Buffer.from("%PDF-1.7 b"));
    as(U_PREP);
    await submitPost(json("POST"), ctx({ id: s.drawingId, revId: b.id }));
    as(U_ADMIN, "admin");
    await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: b.id }));
    as(U_PREP);
    const c = await j(await revsPost(json("POST", {}), ctx({ id: s.drawingId })));
    const again = await elementsPost((await scheduleForm(csvRows, "s.csv", { mode: "load" })).request, ctx({ id: s.drawingId, revId: c.id }));
    expect(again.status).toBe(409);
    expect((await j(again)).error).toMatch(/already loaded on revision B/);
    expect(h.current.rows("drawing_revision_elements").filter((e) => e.revision_id === c.id)).toHaveLength(0);
  });
  it("only a draft takes elements, and the elements of a released revision stay as they were", async () => {
    const s = await submitted();
    const { request } = await scheduleForm(SCHEDULE, "s.xlsx", { mode: "load" });
    expect((await elementsPost(request, ctx({ id: s.drawingId, revId: s.revId }))).status).toBe(409);
  });
  it("refuses an IFC model with the honest reason, a non-schedule file and SVG content", async () => {
    const { body: d } = await makeDrawing();
    const c = ctx({ id: d.id, revId: d.revision.id });
    const form = (name: string, body: string) => { const f = new FormData(); f.set("mode", "preview"); f.set("file", new File([body], name)); return new NextRequest(new URL("http://internal.invalid/x"), { method: "POST", body: f }); };
    const ifc = await elementsPost(form("model.ifc", "ISO-10303-21;"), c);
    expect(ifc.status).toBe(422);
    expect((await j(ifc)).error).toMatch(/later step/);
    expect((await elementsPost(form("plan.pdf", "%PDF"), c)).status).toBe(422);
    expect((await elementsPost(form("evil.csv", "<svg><script>alert(1)</script></svg>"), c)).status).toBe(422);
  });
  it("a viewer cannot load elements", async () => {
    const { body: d } = await makeDrawing();
    h.current.state.edit = false;
    const { request } = await scheduleForm(SCHEDULE, "s.xlsx", { mode: "load" });
    expect((await elementsPost(request, ctx({ id: d.id, revId: d.revision.id }))).status).toBe(403);
  });
  it("a column map is saved on the type only by an admin", async () => {
    const { body: d } = await makeDrawing();
    const a = await scheduleForm(SCHEDULE, "s.xlsx", { mode: "load", save_map: "true" });
    await elementsPost(a.request, ctx({ id: d.id, revId: d.revision.id }));
    expect(h.current.rows("drawing_types")[0].schedule_map ?? null).toBeNull();
    as(U_ADMIN, "admin");
    const { body: d2 } = await makeDrawing({ drawing_no: "ADM-1" });
    const b = await scheduleForm([["Mark", "Count"], ["Z1", "1"]], "s2.xlsx", { mode: "load", save_map: "true" });
    await elementsPost(b.request, ctx({ id: d2.id, revId: d2.revision.id }));
    expect(h.current.rows("drawing_types")[0].schedule_map).toMatchObject({ columns: { element_code: "Mark", qty: "Count" } });
  });
});

describe("comparing revisions", () => {
  async function twoRevisions() {
    const s = await submitted();
    const a = ctx({ id: s.drawingId, revId: s.revId });
    const first = await scheduleForm(SCHEDULE, "a.xlsx", { mode: "load" });
    // revision A is already submitted: put its elements in directly (as a released baseline would have)
    const tid = T1;
    h.current.rows("drawing_revision_elements").push(
      { id: id(401), tenant_id: tid, revision_id: s.revId, drawing_id: s.drawingId, row_no: 1, element_code: "WP-001", element_type: "Wall panel", building: "B1", qty: 4, volume_m3: 2.5, weight_t: 6.25 },
      { id: id(402), tenant_id: tid, revision_id: s.revId, drawing_id: s.drawingId, row_no: 2, element_code: "WP-002", element_type: "Wall panel", building: "B1", qty: 2, volume_m3: 3, weight_t: 7.5 },
    );
    void first; void a;
    as(U_ADMIN, "admin");
    await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    as(U_PREP);
    const b = await j(await revsPost(json("POST", {}), ctx({ id: s.drawingId })));
    const next = await scheduleForm([["Mark", "Type", "Building", "Count", "Volume (m3)", "Weight (t)"], ["WP-001", "Wall panel", "B1", "5", "2.5", "6.25"], ["WP-003", "Slab", "B2", "1", "10", "25"]], "b.xlsx", { mode: "load" });
    await elementsPost(next.request, ctx({ id: s.drawingId, revId: b.id }));
    return { s, bId: b.id as string };
  }
  it("shows what was added, removed and changed against the release, and the totals", async () => {
    const { s, bId } = await twoRevisions();
    const res = await compareGet(json("GET", undefined, "http://internal.invalid/x") as NextRequest, ctx({ id: s.drawingId }));
    expect(res.status).toBe(200);
    const out = await j(res);
    expect(out.to.id).toBe(bId);
    expect(out.from.id).toBe(s.revId);
    expect(out.comparison.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 0, notMatched: 0 });
    expect(out.comparison.totals).toMatchObject({ count_from: 6, count_to: 6 });
  });
  it("submitting the new revision keeps the counts for the list chip", async () => {
    const { s, bId } = await twoRevisions();
    await submitPost(json("POST"), ctx({ id: s.drawingId, revId: bId }));
    expect(h.current.rows("drawing_revisions").find((r) => r.id === bId)?.change_summary).toMatchObject({ added: 1, removed: 1, changed: 1 });
  });
  it("is read-only: nothing is written by looking", async () => {
    const { s } = await twoRevisions();
    const before = JSON.stringify([h.current.rows("drawing_revisions"), h.current.rows("drawing_revision_elements"), h.current.rows("tender_boq_lines")]);
    await compareGet(json("GET", undefined, "http://internal.invalid/x") as NextRequest, ctx({ id: s.drawingId }));
    expect(JSON.stringify([h.current.rows("drawing_revisions"), h.current.rows("drawing_revision_elements"), h.current.rows("tender_boq_lines")])).toBe(before);
  });
});

describe("Data Workbench", () => {
  const rowsOf = (...values: Record<string, string>[]) => ({ rows: values.map((v, i) => ({ rowNum: i + 1, values: v })) });
  it("import loads drafts only: never released, one first revision each, the type by name", async () => {
    const type = (n: number, name: string) => ({ id: id(n), tenant_id: T1, name, numbering_pattern: null, rev_scheme: "letters", approver_ids: [], second_person: true, required_fields: [], feeds: [], active: true, sort_order: n });
    h.current.rows("drawing_types").push(type(60, "Shop drawing"), type(61, "Drawing"));
    const res = await importPost(json("POST", rowsOf(
      { drawing_no: "OLD-001", title: "Existing drawing", type_name: "shop drawing", status: "released", current_rev_id: id(5) },
      { drawing_no: "OLD-002", title: "Another" },
      { drawing_no: "OLD-001", title: "Duplicate number" },
      { drawing_no: "OLD-004", title: "Bad type", type_name: "Nonexistent" },
    )));
    const out = await j(res);
    expect(out).toMatchObject({ inserted: 2, failed: 2 });
    const ds = h.current.rows("drawings");
    expect(ds.map((d) => [d.drawing_no, d.current_rev_id ?? null, d.type_id === id(60)])).toEqual([["OLD-001", null, true], ["OLD-002", null, false]]);
    expect(h.current.rows("drawing_revisions").map((r) => [r.rev_label, r.status, r.file_path ?? null])).toEqual([["A", "draft", null], ["A", "draft", null]]);
    expect(h.current.state.memberWrites).toEqual([]);
  });
  it("a viewer cannot import or update", async () => {
    h.current.state.edit = false;
    expect((await importPost(json("POST", rowsOf({ drawing_no: "X-1", title: "x" })))).status).toBe(403);
    expect((await updatePost(json("POST", rowsOf({ id: id(1), title: "x" })))).status).toBe(403);
  });
  it("export carries the real id and the released revision", async () => {
    const s = await submitted();
    as(U_ADMIN, "admin");
    await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    const out = await j(await exportPost(json("POST", {})));
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ id: s.drawingId, drawing_no: "PRJ1-ARC-001", released_rev: "A", type_name: "Drawing" });
  });
  it("export is this workspace's only", async () => {
    h.current.rows("drawings").push({ id: id(200), tenant_id: T2, ref: "DWG-0001", drawing_no: "THEIRS", title: "t", custom_data: {}, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" });
    await makeDrawing();
    const out = await j(await exportPost(json("POST", {})));
    expect(out.rows.map((r: Record<string, string>) => r.drawing_no)).toEqual(["PRJ1-ARC-001"]);
  });
  it("update matches the real id in this workspace only, and changes header fields only", async () => {
    const { body: d } = await makeDrawing();
    h.current.rows("drawings").push({ id: id(200), tenant_id: T2, ref: "DWG-0001", drawing_no: "THEIRS", title: "theirs", custom_data: {}, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" });
    const out = await j(await updatePost(json("POST", rowsOf(
      { id: d.id, title: "Renamed by file", status: "released", current_rev_id: id(5), tenant_id: T2 },
      { id: id(200), title: "Hijack" },
      { title: "no id" },
    ))));
    expect(out).toMatchObject({ updated: 1, failed: 2 });
    const mine = h.current.rows("drawings").find((x) => x.id === d.id)!;
    expect(mine).toMatchObject({ title: "Renamed by file", tenant_id: T1 });
    expect(mine.current_rev_id ?? null).toBeNull();
    expect(h.current.rows("drawings").find((x) => x.id === id(200))?.title).toBe("theirs");
  });
  it("update changes the number only while nothing was submitted", async () => {
    const free = (await makeDrawing({ drawing_no: "FREE-1" })).body;
    const s = await submitted({ drawing_no: "LOCK-1" });
    const out = await j(await updatePost(json("POST", rowsOf({ id: free.id, drawing_no: "FREE-2" }, { id: s.drawingId, drawing_no: "LOCK-2" }))));
    expect(out).toMatchObject({ updated: 1, failed: 1 });
    expect(h.current.rows("drawings").map((x) => x.drawing_no).sort()).toEqual(["FREE-2", "LOCK-1"]);
  });
});

describe("the people on a drawing", () => {
  it("a drawing's detail names who submitted and released it", async () => {
    const s = await submitted();
    as(U_ADMIN, "admin");
    await releasePost(json("POST", {}), ctx({ id: s.drawingId, revId: s.revId }));
    const out = await j(await oneGet(json("GET"), ctx({ id: s.drawingId })));
    expect(out.revisions[0]).toMatchObject({ status: "released", submitted_by_name: "Priya Preparer", released_by_name: "Alma Admin" });
    expect(U_OTHER).toBeTruthy();
  });
});
