import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DRAWING_API_FIELDS, loadDrawingsForApi } from "./apiRows";
import { EXPLICIT_SCOPE_ONLY, scopeAllows } from "@/app/api/v1/_auth";
import { canReadChangeType } from "@/lib/api/changeFeedScope";
import { T1, T2, id, makeHarness, type Harness } from "./testing/harness";

// What the v1 API and the assistant's Talk to data may say about a drawing: the header and the RELEASED revision, nothing else.

let h: Harness;
beforeEach(() => {
  h = makeHarness();
  h.rows("drawing_types").push({ id: id(60), tenant_id: T1, name: "Shop drawing" });
  h.rows("drawings").push(
    { id: id(100), tenant_id: T1, ref: "DWG-0001", drawing_no: "A-1", external_no: "C-1", title: "Released one", type_id: id(60), opportunity_id: id(5), project_id: null, current_rev_id: id(110), archived_at: null, created_at: "2026-11-01", updated_at: "2026-11-02" },
    { id: id(101), tenant_id: T1, ref: "DWG-0002", drawing_no: "A-2", title: "Draft only", type_id: id(60), current_rev_id: null, archived_at: null, created_at: "2026-11-01", updated_at: "2026-11-02" },
    { id: id(102), tenant_id: T1, ref: "DWG-0003", drawing_no: "A-3", title: "Archived", current_rev_id: null, archived_at: "2026-11-05", created_at: "2026-11-01", updated_at: "2026-11-02" },
    { id: id(103), tenant_id: T2, ref: "DWG-0001", drawing_no: "THEIRS", title: "Another workspace", current_rev_id: id(130), archived_at: null, created_at: "2026-11-01", updated_at: "2026-11-02" },
  );
  h.rows("drawing_revisions").push(
    { id: id(110), tenant_id: T1, drawing_id: id(100), rev_label: "B", status: "released", released_at: "2026-11-03T10:00:00Z", effective_from: "2026-11-03", file_path: `${T1}/${id(100)}/${id(110)}/secret.pdf`, file_sha256: "a".repeat(64), submitted_by: id(11), notes: "internal note", source_ref: "acc:v9" },
    { id: id(111), tenant_id: T1, drawing_id: id(100), rev_label: "C", status: "in_review", file_path: "x" },
    { id: id(130), tenant_id: T2, drawing_id: id(103), rev_label: "A", status: "released", released_at: "2026-11-03T10:00:00Z" },
  );
});

describe("the drawings the API shows", () => {
  it("the header and the released revision, this workspace only, archived ones left out", async () => {
    const rows = await loadDrawingsForApi(h.admin() as never, T1);
    expect(rows.map((r) => r.drawing_no)).toEqual(["A-1", "A-2"]);
    expect(rows[0]).toMatchObject({ ref: "DWG-0001", external_no: "C-1", type: "Shop drawing", released: true, released_rev: "B", effective_from: "2026-11-03", opportunity_id: id(5) });
    expect(rows[1]).toMatchObject({ released: false, released_rev: null });
  });
  it("never a file path, a fingerprint, a connector id, a note, a person or a draft's state", async () => {
    const text = JSON.stringify(await loadDrawingsForApi(h.admin() as never, T1));
    for (const secret of ["secret.pdf", "a".repeat(64), "acc:v9", "internal note", "in_review", "file_path", "file_sha256", "submitted_by", "THEIRS", id(11)]) expect(text).not.toContain(secret);
  });
  it("one drawing by id, and another workspace's id finds nothing", async () => {
    expect((await loadDrawingsForApi(h.admin() as never, T1, id(100)))).toHaveLength(1);
    expect((await loadDrawingsForApi(h.admin() as never, T1, id(103)))).toHaveLength(0);
  });
  it("every queryable field is on the shape", async () => {
    const [row] = await loadDrawingsForApi(h.admin() as never, T1, id(100));
    for (const f of DRAWING_API_FIELDS) expect(f.path in row).toBe(true);
    expect(DRAWING_API_FIELDS.map((f) => f.path)).not.toEqual(expect.arrayContaining(["file_path", "file_sha256"]));
  });
});

describe("who may read it", () => {
  it("a wildcard key does not reach drawings: the key must name them", () => {
    expect(EXPLICIT_SCOPE_ONLY.has("drawings")).toBe(true);
    expect(scopeAllows({ read: true, write: false, objects: ["*"] }, "drawings", false)).toBe(false);
    expect(scopeAllows({ read: true, write: false, objects: ["drawings"] }, "drawings", false)).toBe(true);
    expect(scopeAllows({ read: true, write: false, objects: ["drawings"] }, "drawings", true)).toBe(false);
  });
  it("the change feed follows the same rule", () => {
    expect(canReadChangeType({ read: true, write: false, objects: ["*"] }, "drawings")).toBe(false);
    expect(canReadChangeType({ read: true, write: false, objects: ["drawings"] }, "drawings")).toBe(true);
  });
  it("the routes ask the one gate with the object name, and there is no write verb", () => {
    const root = path.resolve(__dirname, "../../..");
    for (const f of ["src/app/api/v1/drawings/route.ts", "src/app/api/v1/drawings/[id]/route.ts"]) {
      const src = readFileSync(path.join(root, f), "utf8");
      expect(src).toMatch(/authorizeApi\(req, "drawings"\)/);
      expect(src).not.toMatch(/export async function (POST|PATCH|PUT|DELETE)/);
    }
  });
});
