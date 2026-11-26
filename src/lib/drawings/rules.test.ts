import { describe, expect, it } from "vitest";
import {
  canTransition, drawingNoProblem, headlineRevision, isDeletable, isEditable, lettersLabel, mayRelease, mayReturn, nextRevNo, normaliseDrawingNo,
  numberingProblem, patternToRegExp, releaseDecision, revLabelFor, revLabelProblem, submitProblems,
} from "./rules";
import { cleanType } from "./typeRules";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

describe("revision labels", () => {
  it("letters run A..Z then AA, AB (a label never repeats)", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(lettersLabel)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  });
  it("follows the type's scheme", () => {
    expect(revLabelFor("letters", 2)).toBe("C");
    expect(revLabelFor("numbers", 0)).toBe("0");
    expect(revLabelFor("numbers", 3)).toBe("3");
  });
  it("the next number is one past the highest", () => {
    expect(nextRevNo([])).toBe(0);
    expect(nextRevNo([{ rev_no: 0 }, { rev_no: 2 }, { rev_no: 1 }])).toBe(3);
  });
  it("a hand-typed label is short and printable", () => {
    expect(revLabelProblem("B")).toBeNull();
    expect(revLabelProblem("P1.2")).toBeNull();
    expect(revLabelProblem("")).not.toBeNull();
    expect(revLabelProblem("has space")).not.toBeNull();
    expect(revLabelProblem("a/b")).not.toBeNull();
    expect(revLabelProblem("x".repeat(13))).not.toBeNull();
  });
});

describe("drawing numbers and the numbering pattern", () => {
  it("normalises and refuses odd characters", () => {
    expect(normaliseDrawingNo("  PRJ1   ARC 001 ")).toBe("PRJ1 ARC 001");
    expect(drawingNoProblem("PRJ1-ARC-001")).toBeNull();
    expect(drawingNoProblem("")).not.toBeNull();
    expect(drawingNoProblem("a/b")).not.toBeNull();
    expect(drawingNoProblem("<x>")).not.toBeNull();
  });
  it("{seq3} is exactly three digits, other words are letters and digits, the rest is literal", () => {
    const p = "{project}-{discipline}-{seq3}";
    expect(numberingProblem(p, "PRJ1-ARC-001")).toBeNull();
    expect(numberingProblem(p, "prj1-arc-001")).toBeNull();
    expect(numberingProblem(p, "PRJ1-ARC-01")).not.toBeNull();
    expect(numberingProblem(p, "PRJ1-ARC-0012")).not.toBeNull();
    expect(numberingProblem(p, "PRJ1_ARC_001")).not.toBeNull();
    expect(numberingProblem("DWG.{seq}", "DWG.12345")).toBeNull();
  });
  it("no pattern accepts any number, and special characters in a pattern are literal", () => {
    expect(numberingProblem(null, "anything")).toBeNull();
    expect(numberingProblem("  ", "anything")).toBeNull();
    expect(patternToRegExp("A+B({seq3})").test("A+B(123)")).toBe(true);
    expect(patternToRegExp("A+B({seq3})").test("AAB(123)")).toBe(false);
  });
});

describe("the status flow", () => {
  it("only the allowed edges", () => {
    expect(canTransition("draft", "in_review")).toBe(true);
    expect(canTransition("in_review", "released")).toBe(true);
    expect(canTransition("in_review", "draft")).toBe(true);
    expect(canTransition("released", "superseded")).toBe(true);
    expect(canTransition("draft", "released")).toBe(false);
    expect(canTransition("released", "draft")).toBe(false);
    expect(canTransition("released", "in_review")).toBe(false);
    expect(canTransition("superseded", "released")).toBe(false);
  });
  it("only a draft is editable and only a never-submitted draft is deletable", () => {
    expect(isEditable({ status: "draft" })).toBe(true);
    expect(isEditable({ status: "in_review" })).toBe(false);
    expect(isEditable({ status: "released" })).toBe(false);
    expect(isDeletable({ status: "draft", submitted_at: null })).toBe(true);
    expect(isDeletable({ status: "draft", submitted_at: "2026-11-01T00:00:00Z" })).toBe(false);
    expect(isDeletable({ status: "released", submitted_at: null })).toBe(false);
  });
});

describe("what is missing before a draft can be submitted", () => {
  const drawing = { drawing_no: "PRJ1-ARC-001", external_no: null, opportunity_id: null, project_id: null, wbs_item_id: null };
  const revision = { rev_label: "A", file_path: "t/d/r/a.pdf", notes: null, change_summary: {} };
  it("a complete draft has no problems", () => {
    expect(submitProblems({ drawing, revision, type: { required_fields: [], numbering_pattern: null } })).toEqual([]);
  });
  it("needs a file or a loaded schedule", () => {
    expect(submitProblems({ drawing, revision: { ...revision, file_path: null }, type: null })).toHaveLength(1);
    expect(submitProblems({ drawing, revision: { ...revision, file_path: null }, type: null, hasElements: true })).toEqual([]);
    expect(submitProblems({ drawing, revision: { ...revision, file_path: null, change_summary: { elements: { source: "schedule", file_name: "x.xlsx", sha256: "a", rows: 3, loaded_at: "" } } }, type: null })).toEqual([]);
  });
  it("applies the type's pattern and required fields", () => {
    const type = { required_fields: ["external_no", "opportunity_id", "notes"], numbering_pattern: "{project}-{discipline}-{seq3}" };
    expect(submitProblems({ drawing: { ...drawing, drawing_no: "bad number" }, revision, type }).some((p) => /pattern/.test(p))).toBe(true);
    const missing = submitProblems({ drawing, revision, type });
    expect(missing).toEqual(expect.arrayContaining(["External number is required for this type", "Tender is required for this type", "Revision note is required for this type"]));
    expect(submitProblems({ drawing: { ...drawing, external_no: "C-1", opportunity_id: A }, revision: { ...revision, notes: "issued for tender" }, type })).toEqual([]);
  });
});

describe("who may release", () => {
  const inReview = { status: "in_review" as const, submitted_by: A };
  it("a named approver may, unless they submitted it (second person)", () => {
    const type = { approver_ids: [B, A], second_person: true };
    expect(releaseDecision({ type, revision: inReview, userId: B, role: "member" })).toEqual({ ok: true });
    const own = releaseDecision({ type, revision: inReview, userId: A, role: "admin" });
    expect(own).toMatchObject({ ok: false, status: 403 });
  });
  it("a person who is not a named approver may not, even an admin, when the type names approvers", () => {
    const type = { approver_ids: [B], second_person: true };
    expect(releaseDecision({ type, revision: inReview, userId: C, role: "admin" })).toMatchObject({ ok: false, status: 403 });
    expect(releaseDecision({ type, revision: inReview, userId: C, role: "member" })).toMatchObject({ ok: false, status: 403 });
  });
  it("a type that names nobody lets a workspace admin release and nobody else", () => {
    const type = { approver_ids: [], second_person: true };
    expect(releaseDecision({ type, revision: inReview, userId: B, role: "admin" })).toEqual({ ok: true });
    expect(releaseDecision({ type, revision: inReview, userId: B, role: "member" })).toMatchObject({ ok: false, status: 403 });
  });
  it("the submitter may release their own only when the type switches the second person off", () => {
    const type = { approver_ids: [A], second_person: false };
    expect(releaseDecision({ type, revision: inReview, userId: A, role: "member" })).toEqual({ ok: true });
  });
  it("no type at all is treated as the strict default", () => {
    expect(releaseDecision({ type: null, revision: inReview, userId: A, role: "admin" })).toMatchObject({ ok: false });
    expect(releaseDecision({ type: null, revision: inReview, userId: B, role: "admin" })).toEqual({ ok: true });
  });
  it("only a revision in review can be released", () => {
    const type = { approver_ids: [B], second_person: true };
    for (const status of ["draft", "released", "superseded"] as const) {
      expect(releaseDecision({ type, revision: { status, submitted_by: A }, userId: B, role: "admin" })).toMatchObject({ ok: false, status: 409 });
    }
  });
  it("mayRelease mirrors it for the button", () => {
    expect(mayRelease({ type: { approver_ids: [B], second_person: true }, submittedBy: A, userId: B, role: "member" })).toBe(true);
    expect(mayRelease({ type: { approver_ids: [B], second_person: true }, submittedBy: B, userId: B, role: "member" })).toBe(false);
  });
  it("who may send it back: the submitter, a named approver or an admin", () => {
    const type = { approver_ids: [B] };
    expect(mayReturn({ type, revision: inReview, userId: A, role: "member" })).toBe(true);
    expect(mayReturn({ type, revision: inReview, userId: B, role: "member" })).toBe(true);
    expect(mayReturn({ type, revision: inReview, userId: C, role: "admin" })).toBe(true);
    expect(mayReturn({ type, revision: inReview, userId: C, role: "member" })).toBe(false);
    expect(mayReturn({ type, revision: { status: "draft", submitted_by: A }, userId: A, role: "admin" })).toBe(false);
  });
});

describe("the revision a drawing is at", () => {
  const revs = [{ id: "r0", status: "superseded" as const, rev_no: 0 }, { id: "r1", status: "released" as const, rev_no: 1 }, { id: "r2", status: "draft" as const, rev_no: 2 }];
  it("is the released one, else the newest", () => {
    expect(headlineRevision(revs, "r1")?.id).toBe("r1");
    expect(headlineRevision(revs.filter((r) => r.status !== "released"), null)?.id).toBe("r2");
    expect(headlineRevision([], null)).toBeNull();
  });
});

describe("a drawing type as a workspace edits it", () => {
  it("cleans a full body and rejects bad shapes", () => {
    const ok = cleanType({ name: " Shop drawing ", numbering_pattern: "{project}-{seq3}", rev_scheme: "numbers", approver_ids: [A, A], second_person: false, required_fields: ["external_no"], feeds: ["boq", "boq"], active: true }, false);
    expect(ok).toMatchObject({ ok: true, value: { name: "Shop drawing", rev_scheme: "numbers", approver_ids: [A], second_person: false, feeds: ["boq"] } });
    expect(cleanType({ name: "" }, false)).toMatchObject({ ok: false });
    expect(cleanType({ name: "x", rev_scheme: "roman" }, false)).toMatchObject({ ok: false });
    expect(cleanType({ name: "x", approver_ids: ["nope"] }, false)).toMatchObject({ ok: false });
    expect(cleanType({ name: "x", required_fields: ["password"] }, false)).toMatchObject({ ok: false });
    expect(cleanType({ name: "x", feeds: ["f-and-o"] }, false)).toMatchObject({ ok: false });
  });
  it("a patch cleans only the keys present", () => {
    expect(cleanType({ active: false }, true)).toEqual({ ok: true, value: { active: false } });
  });
});
