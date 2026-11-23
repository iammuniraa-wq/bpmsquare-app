import { beforeEach, describe, expect, it, vi } from "vitest";
import { T1, T2, U_PREP, id, makeHarness, type Harness } from "./testing/harness";

// A tender BOQ line that takes a quantity from a RELEASED drawing revision: the pin, the "review changes" flag a later release raises, the
// apply / dismiss decisions, and the baseline blocker. The view `released_drawing_elements` is stood in by a table rebuilt from the elements and
// the revisions' states before every read, so a draft or in-review revision can never feed a line in these tests either.

const h = vi.hoisted(() => ({ current: null as unknown as Harness, boqGate: null as null | ((id: string, write: boolean) => unknown), canEdit: true, canView: true }));
vi.mock("@/lib/supabase-server", () => ({
  createAdminSupabase: () => h.current.admin(),
  getAuthUser: async () => h.current.state.user,
  requireTenantUser: async () => ({ tenantId: h.current.state.tenantId, userId: h.current.state.user.id, role: h.current.state.role, supabase: h.current.session() }),
}));
vi.mock("@/lib/tenant", () => ({ tenantHasFeature: async (_s: unknown, _t: string, key: string) => !!h.current.state.features[key] }));
vi.mock("@/lib/permissions", () => ({ resolvePermissions: async () => ({}), canViewWorkcenter: () => h.canView, canEditWorkcenter: () => h.canEdit }));
vi.mock("@/lib/changeLog", () => ({ logChange: async (_c: unknown, p: Harness["state"]["changes"][number]) => { h.current.state.changes.push(p); }, diffForLog: () => [] }));
vi.mock("@/lib/tender/boq/server", () => ({ openBoqRequest: async (oppId: string, write: boolean) => (h.boqGate ? h.boqGate(oppId, write) : { ok: false, status: 404, error: "Not found" }) }));

import { applyPin, boqDrawingFlags, dismissPin, drawingBaselineBlocker, groupsForTender, loadPins, loadPinsOfDrawing, openPinRequest, pinLine, unpinLine } from "./boqPins";
import type { BoqRequest } from "@/lib/tender/boq/server";

const OPP = id(500), OPP2 = id(501), D1 = id(600), RA = id(610), RB = id(611), RC = id(612), LINE = id(700), LINE_T2 = id(701), LINE_OPP2 = id(702);

const req = (): BoqRequest => ({ admin: h.current.admin() as never, supabase: h.current.session() as never, tenantId: T1, userId: U_PREP, role: "member", opp: { id: OPP, title: "Tower 3" } as never, tender: {} as never });

/** Rebuild the view table from the real elements and revisions: only elements of RELEASED revisions are in it. */
function syncView() {
  const rows = h.current.rows("released_drawing_elements");
  rows.length = 0;
  for (const e of h.current.rows("drawing_revision_elements")) {
    const rev = h.current.rows("drawing_revisions").find((r) => r.id === e.revision_id);
    const d = h.current.rows("drawings").find((x) => x.id === e.drawing_id);
    if (!rev || rev.status !== "released" || !d) continue;
    rows.push({ ...e, drawing_no: d.drawing_no, drawing_title: d.title, opportunity_id: d.opportunity_id, project_id: d.project_id, rev_label: rev.rev_label, rev_no: rev.rev_no, released_at: rev.released_at ?? null, effective_from: null });
  }
}
const el = (rev: string, n: number, code: string, qty: number) => ({ id: id(800 + n), tenant_id: T1, revision_id: rev, drawing_id: D1, row_no: n, element_code: code, element_type: "Slab", building: "B1", qty, volume_m3: 2, weight_t: 5 });

beforeEach(() => {
  h.current = makeHarness();
  h.boqGate = null; h.canEdit = true; h.canView = true;
  const rows = (t: string) => h.current.rows(t);
  rows("opportunities").push({ id: OPP, tenant_id: T1, title: "Tower 3" }, { id: OPP2, tenant_id: T1, title: "Other tender" });
  rows("drawings").push({ id: D1, tenant_id: T1, ref: "DWG-0001", drawing_no: "PRJ1-ARC-001", title: "Slab", opportunity_id: OPP, project_id: null, current_rev_id: RA, archived_at: null });
  rows("drawing_revisions").push(
    { id: RA, tenant_id: T1, drawing_id: D1, rev_no: 0, rev_label: "A", status: "released" },
    { id: RB, tenant_id: T1, drawing_id: D1, rev_no: 1, rev_label: "B", status: "draft" },
  );
  rows("drawing_revision_elements").push(el(RA, 1, "SL-001", 24), el(RA, 2, "SL-001", 6), el(RA, 3, "BM-001", 16), el(RB, 4, "SL-001", 99));
  rows("tender_boq_lines").push(
    { id: LINE, tenant_id: T1, opportunity_id: OPP, item_no: "1.1", row_no: 1, file_description: "Hollow-core slab", file_qty: 30, removed_in_revision: false, drawing_rev_id: null },
    { id: LINE_T2, tenant_id: T2, opportunity_id: OPP, item_no: "9.9", row_no: 1, file_description: "Foreign line", file_qty: 1, removed_in_revision: false, drawing_rev_id: null },
    { id: LINE_OPP2, tenant_id: T1, opportunity_id: OPP2, item_no: "2.1", row_no: 1, file_description: "Another tender's line", file_qty: 1, removed_in_revision: false, drawing_rev_id: null },
  );
  syncView();
});

const line = () => h.current.rows("tender_boq_lines").find((l) => l.id === LINE)!;
/** A later revision C is released: A is superseded, the drawing points at C, with SL-001 now at 40 pieces. */
function releaseC() {
  h.current.rows("drawing_revisions").find((r) => r.id === RA)!.status = "superseded";
  h.current.rows("drawing_revisions").push({ id: RC, tenant_id: T1, drawing_id: D1, rev_no: 2, rev_label: "C", status: "released" });
  h.current.rows("drawings")[0].current_rev_id = RC;
  h.current.rows("drawing_revision_elements").push(el(RC, 5, "SL-001", 40), el(RC, 6, "BM-001", 16));
  syncView();
}

describe("taking a quantity from a released drawing", () => {
  it("pins the line to the released revision and keeps the client's quantity beside the model's", async () => {
    const out = await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "SL-001" });
    expect(out).toMatchObject({ ok: true, pin: { boq_id: LINE, drawing_no: "PRJ1-ARC-001", element_code: "SL-001", pinned_label: "A", model_qty: 30, client_qty: 30, state: "current" } });
    expect(line()).toMatchObject({ element_code: "SL-001", drawing_rev_id: RA, model_qty: 30, file_qty: 30 });
    expect(h.current.state.changes).toHaveLength(1);
    expect(h.current.state.memberWrites).toEqual([]);
  });
  it("a differing quantity is shown as a percentage, never written over the client's", async () => {
    h.current.rows("tender_boq_lines").find((l) => l.id === LINE)!.file_qty = 25;
    const out = await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "SL-001" });
    expect(out).toMatchObject({ ok: true, pin: { client_qty: 25, model_qty: 30, differs_pct: 20 } });
    expect(line().file_qty).toBe(25);
  });
  it("never from a draft or in-review revision: only the released one is read", async () => {
    // SL-001 has 99 pieces in the draft B; the line must get A's 30
    const out = await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "SL-001" });
    expect(out).toMatchObject({ ok: true, pin: { model_qty: 30 } });
    // a code that exists only in the draft is not offered
    h.current.rows("drawing_revision_elements").push(el(RB, 7, "ONLY-IN-DRAFT", 3));
    syncView();
    expect(await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "ONLY-IN-DRAFT" })).toMatchObject({ ok: false, status: 422 });
    const groups = await groupsForTender(h.current.admin() as never, T1, OPP);
    expect(groups.groups.map((g) => g.element_code).sort()).toEqual(["BM-001", "SL-001"]);
  });
  it("a drawing with no released revision cannot feed a line", async () => {
    h.current.rows("drawings")[0].current_rev_id = null;
    h.current.rows("drawing_revisions").find((r) => r.id === RA)!.status = "in_review";
    syncView();
    expect(await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "SL-001" })).toMatchObject({ ok: false, status: 422 });
    expect(line().drawing_rev_id ?? null).toBeNull();
  });
  it("needs a code the released revision has", async () => {
    expect(await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "" })).toMatchObject({ ok: false, status: 422 });
    expect(await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "NOPE-1" })).toMatchObject({ ok: false, status: 422 });
  });
  it("a line of another workspace, or of another tender, is never touched", async () => {
    expect(await pinLine(req(), { boq_line_id: LINE_T2, drawing_id: D1, element_code: "SL-001" })).toMatchObject({ ok: false, status: 404 });
    expect(await pinLine(req(), { boq_line_id: LINE_OPP2, drawing_id: D1, element_code: "SL-001" })).toMatchObject({ ok: false, status: 404 });
    expect(await pinLine(req(), { boq_line_id: "not-a-uuid", drawing_id: D1, element_code: "SL-001" })).toMatchObject({ ok: false, status: 404 });
    expect(h.current.rows("tender_boq_lines").filter((l) => l.drawing_rev_id)).toHaveLength(0);
  });
  it("a drawing of another workspace, or filed under another tender, cannot be used", async () => {
    h.current.rows("drawings").push({ id: id(601), tenant_id: T2, ref: "DWG-0001", drawing_no: "THEIRS", title: "t", opportunity_id: OPP, current_rev_id: id(613), archived_at: null });
    expect(await pinLine(req(), { boq_line_id: LINE, drawing_id: id(601), element_code: "X" })).toMatchObject({ ok: false, status: 404 });
    h.current.rows("drawings")[0].opportunity_id = OPP2;
    expect(await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "SL-001" })).toMatchObject({ ok: false, status: 422 });
  });
});

describe("a new release changes nothing by itself", () => {
  beforeEach(async () => { await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "SL-001" }); });

  it("the line keeps its quantity and is flagged for review", async () => {
    releaseC();
    expect(line()).toMatchObject({ drawing_rev_id: RA, model_qty: 30 });
    const { pins } = await loadPins(h.current.admin() as never, T1, OPP);
    expect(pins[0]).toMatchObject({ state: "review", pinned_label: "A", current_label: "C", chip: "Rev C released: review changes" });
    const flags = await boqDrawingFlags(h.current.admin() as never, T1, OPP);
    expect(flags.get(LINE)).toEqual({ label: "Rev C released: review changes", review: true });
  });
  it("applying takes the new quantity and pins to the new revision", async () => {
    releaseC();
    const out = await applyPin(req(), LINE);
    expect(out).toMatchObject({ ok: true, pin: { state: "current", pinned_label: "C", model_qty: 40 } });
    expect(line()).toMatchObject({ drawing_rev_id: RC, model_qty: 40, drawing_review_rev_id: null });
  });
  it("applying is refused when the new revision no longer has the code", async () => {
    releaseC();
    h.current.rows("drawing_revision_elements").splice(h.current.rows("drawing_revision_elements").findIndex((e) => e.id === id(805)), 1);
    syncView();
    expect(await applyPin(req(), LINE)).toMatchObject({ ok: false, status: 422 });
    expect(line()).toMatchObject({ drawing_rev_id: RA, model_qty: 30 });
  });
  it("keeping the old quantity needs a reason, and is quiet for that release only", async () => {
    releaseC();
    expect(await dismissPin(req(), LINE, " ")).toMatchObject({ ok: false, status: 422 });
    const out = await dismissPin(req(), LINE, "The consultant confirmed the extra slabs are provisional");
    expect(out).toMatchObject({ ok: true, pin: { state: "dismissed", dismissed_reason: "The consultant confirmed the extra slabs are provisional", model_qty: 30 } });
    expect((await boqDrawingFlags(h.current.admin() as never, T1, OPP)).get(LINE)?.review).toBe(false);
    // a still later release asks again
    h.current.rows("drawing_revisions").find((r) => r.id === RC)!.status = "superseded";
    h.current.rows("drawing_revisions").push({ id: id(613), tenant_id: T1, drawing_id: D1, rev_no: 3, rev_label: "D", status: "released" });
    h.current.rows("drawings")[0].current_rev_id = id(613);
    expect((await loadPins(h.current.admin() as never, T1, OPP)).pins[0].state).toBe("review");
  });
  it("there is nothing to dismiss when no newer release exists", async () => {
    expect(await dismissPin(req(), LINE, "why")).toMatchObject({ ok: false, status: 409 });
  });
  it("removing the pin leaves the client's quantity alone", async () => {
    expect(await unpinLine(req(), LINE)).toMatchObject({ ok: true, pin: null });
    expect(line()).toMatchObject({ drawing_rev_id: null, element_code: null, model_qty: null, file_qty: 30 });
  });
  it("the drawing's own screen lists the lines that use it, across tenders", async () => {
    const { pins } = await loadPinsOfDrawing(h.current.admin() as never, T1, D1);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ opportunity_id: OPP, boq_id: LINE });
  });
});

describe("the baseline blocker", () => {
  beforeEach(async () => { await pinLine(req(), { boq_line_id: LINE, drawing_id: D1, element_code: "SL-001" }); });
  it("does not block while every line is on the released revision", async () => {
    expect(await drawingBaselineBlocker(h.current.admin() as never, T1, OPP)).toBeNull();
  });
  it("blocks while a line still carries a quantity from an older revision, and says which", async () => {
    releaseC();
    const msg = await drawingBaselineBlocker(h.current.admin() as never, T1, OPP);
    expect(msg).toMatch(/1 bill of quantities line still carries/);
    expect(msg).toMatch(/PRJ1-ARC-001 A to C/);
  });
  it("is released once the change is applied or dismissed with a reason", async () => {
    releaseC();
    await dismissPin(req(), LINE, "kept on purpose");
    expect(await drawingBaselineBlocker(h.current.admin() as never, T1, OPP)).toBeNull();
  });
  it("does not exist for a workspace without the register or for a project with no tender", async () => {
    releaseC();
    expect(await drawingBaselineBlocker(h.current.admin() as never, T1, null)).toBeNull();
    h.current.state.features.drawing_register = false;
    expect(await drawingBaselineBlocker(h.current.admin() as never, T1, OPP)).toBeNull();
  });
  it("reads as nothing, never an error, while the pin columns are not there yet", async () => {
    h.current.db.missingColumns.tender_boq_lines = new Set(["drawing_rev_id"]);
    expect(await drawingBaselineBlocker(h.current.admin() as never, T1, OPP)).toBeNull();
    expect((await boqDrawingFlags(h.current.admin() as never, T1, OPP)).size).toBe(0);
    expect((await loadPins(h.current.admin() as never, T1, OPP)).pending).toBe(true);
  });
});

describe("the gate of the BOQ drawing routes", () => {
  const open = () => { h.boqGate = () => ({ ok: true, req: req() }); };
  it("a workspace without the register gets 404, as if the route did not exist", async () => {
    open();
    h.current.state.features.drawing_register = false;
    expect(await openPinRequest(OPP, false)).toMatchObject({ ok: false, status: 404 });
  });
  it("a person who may not open Engineering gets 404, and a viewer cannot write", async () => {
    open();
    h.canView = false;
    expect(await openPinRequest(OPP, false)).toMatchObject({ ok: false, status: 404 });
    h.canView = true; h.canEdit = false;
    expect(await openPinRequest(OPP, false)).toMatchObject({ ok: true });
    expect(await openPinRequest(OPP, true)).toMatchObject({ ok: false, status: 403 });
  });
  it("the tender's own gate comes first: another workspace's deal is 404 whatever the register says", async () => {
    // openBoqRequest says no (the deal is not in this workspace, or the tender edition is off)
    expect(await openPinRequest(id(999), false)).toMatchObject({ ok: false, status: 404 });
  });
  it("a person with every right gets the request", async () => {
    open();
    expect(await openPinRequest(OPP, true)).toMatchObject({ ok: true });
  });
});
