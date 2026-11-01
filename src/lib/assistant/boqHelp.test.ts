import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOQ_LIMITS } from "@/lib/tender/boq/parse";
import { TENDER_BOQ_LINES_SPEC } from "@/lib/import/tenderBoqLinesSchema";
import { DATA_WORKBENCH_TARGET, TENDER_API_PATHS, TENDER_MCP_TOOLS, boqHelpAnswer, boqUploadRule, isBoqHelpQuestion } from "./boqHelp";
import { buildNavTargets, tenderBoqTarget, TENDER_BOQ_LIST_TARGET, type NavGateCtx } from "./navTargets";

// What the assistant is told about the tender BOQ. The facts are built from the product's own constants, and Data Workbench is described
// only to a person whose NAVIGATION list contains it (the same gate that makes the assistant decline a screen that is not switched on).

const root = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const UUID = "0b8f2a6e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

const ctx = (features: Record<string, boolean>): NavGateCtx => ({
  features, isAdmin: true, isWfmSupervisor: false, canView: () => true, canCreate: () => true, canEdit: () => true,
});
const withTenders = { pipeline: true, gcc_tender: true };

describe("the BOQ rule", () => {
  const on = boqUploadRule(buildNavTargets(ctx({ ...withTenders, data_workbench: true })));
  const off = boqUploadRule(buildNavTargets(ctx(withTenders)));

  it("names the real limits and columns, the Narration and Description rule and the client columns", () => {
    expect(BOQ_LIMITS.maxLines).toBe(2000);
    for (const rule of [on, off]) {
      expect(rule).toContain("2,000 lines and 15 MB");
      expect(rule).toContain("Item no., Description, Unit, Quantity");
      expect(rule).toContain("Narration");
      expect(rule).toContain("kept as details");
      expect(rule).toContain("Sr #, Bill #, Section, Page # and Revision #");
      expect(rule).toContain("Project Code and Project Name");
      expect(rule).toContain("Download BOQ template");
    }
  });

  it("with Data Workbench on, names its object and the three modes as they behave", () => {
    expect(DATA_WORKBENCH_TARGET).toBe("nav:/data-workbench");
    expect(on).toContain(`Data Workbench has the object "${TENDER_BOQ_LINES_SPEC.label}"`);
    expect(on).toContain("never removes a line");
    expect(on).toContain("Record ID");
    expect(on).toContain("quantity, description, details and cost code");
  });

  it("with Data Workbench off, never offers it: it says it is not switched on and points to Upload BOQ", () => {
    expect(off).not.toContain("has the object");
    expect(off).not.toContain(TENDER_BOQ_LINES_SPEC.label);
    expect(off).toContain("Data Workbench is not switched on");
    expect(off).toContain("Upload BOQ");
    expect(off).toContain("never describe Data Workbench steps");
  });

  it("names the v1 endpoints, the tenders scope and the MCP tools, and promises no cost, markup or supplier name", () => {
    for (const rule of [on, off]) {
      for (const p of TENDER_API_PATHS) expect(rule).toContain(p);
      for (const t of TENDER_MCP_TOOLS) expect(rule).toContain(t);
      expect(rule).toContain("tenders scope");
      expect(rule).toMatch(/Cost, markup and supplier names are never exposed/);
      expect(rule).toContain("client columns");
    }
  });

  it("the API paths and tool names it quotes exist in the manifest and the API index", () => {
    const mcp = JSON.parse(read("mcp-server/mcp.json")) as { tools: { name: string; path: string }[] };
    for (const name of TENDER_MCP_TOOLS) expect(mcp.tools.map((t) => t.name), name).toContain(name);
    for (const p of TENDER_API_PATHS) expect(mcp.tools.map((t) => t.path), p).toContain(p);
    const index = read("src/app/api/v1/route.ts");
    for (const e of ["GET /api/v1/tenders\"", "GET /api/v1/tenders/:id\"", "GET /api/v1/tenders/:id/boq\""]) expect(index).toContain(e);
  });

  it("points at the open tender when there is one, else at the tender list, and is empty without the tender edition", () => {
    expect(on).toContain(`navigate with ${TENDER_BOQ_LIST_TARGET}`);
    expect(boqUploadRule([...buildNavTargets(ctx(withTenders)), tenderBoqTarget(UUID)])).toContain(`navigate with ${tenderBoqTarget(UUID).id}`);
    expect(boqUploadRule(buildNavTargets(ctx({ pipeline: true })))).toBe("");
  });
});

// The same questions answered by the server with no model (KAMCO 2026-11-01).
const KAMCO_QUESTION = "I want to upload a big BOQ from the client's own excel, which format do you need?";

describe("isBoqHelpQuestion", () => {
  it.each([
    KAMCO_QUESTION,
    "how do I upload a BOQ",
    "which columns does the BOQ upload read",
    "can I use the client's own Excel for the BOQ or do I have to retype it",
    "what are the limits for a BOQ file",
    "how many lines can a bill of quantities have",
    "how do I bulk import and export BOQ lines",
    "can I pull the BOQ through the API",
    "which MCP tools give me the tender BOQ",
    "is there a BOQ template",
    "what format should the bill of quantities be in",
    "How do I import the BOQ?",
  ])("matches: %s", (q) => expect(isBoqHelpQuestion(q)).toBe(true));

  it.each([
    "upload a quote",
    "I need an estimate template",
    "where is data workbench",
    "what is the total value of the BOQ",
    "how many lines does the BOQ of this tender have",
    "which items in the BOQ have no rate",
    "open tenders",
    "upload the price list excel",
    "",
  ])("does not match: %s", (q) => expect(isBoqHelpQuestion(q)).toBe(false));
});

describe("boqHelpAnswer", () => {
  const list = buildNavTargets(ctx(withTenders));
  const bench = buildNavTargets(ctx({ ...withTenders, data_workbench: true }));

  it("the KAMCO question gets where, template, columns, limits and the Data Workbench line, in short lines", () => {
    const r = boqHelpAnswer(KAMCO_QUESTION, list)!;
    const lines = r.answer.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(r.answer).toContain("Upload BOQ");
    expect(r.answer).toContain("Download BOQ template");
    expect(r.answer).toContain("2,000 lines and 15 MB");
    expect(r.answer).toContain("Item no., Description, Unit, Quantity");
    expect(r.answer).toContain("Narration");
    expect(r.answer).toContain("Description is kept as details");
    expect(r.answer).not.toMatch(/button above/i);
    expect(r.target.id).toBe(TENDER_BOQ_LIST_TARGET);
  });

  it("describes Data Workbench only when it is in the person's navigation list", () => {
    const on = boqHelpAnswer("how do I bulk import and export BOQ lines", bench)!.answer;
    expect(on).toContain(`"${TENDER_BOQ_LINES_SPEC.label}"`);
    expect(on).toContain("never removes a line");
    const off = boqHelpAnswer("how do I bulk import and export BOQ lines", list)!.answer;
    expect(off).not.toContain(TENDER_BOQ_LINES_SPEC.label);
    expect(off).toContain("Data Workbench is not switched on");
    expect(off).toContain("Upload BOQ");
  });

  it("leaves out the Data Workbench and API lines when the question is not about them", () => {
    const a = boqHelpAnswer("which columns does the BOQ upload read", bench)!.answer;
    expect(a).not.toContain("Data Workbench");
    expect(a).not.toContain("/api/v1");
  });

  it("names the endpoints and tools only for an API or MCP question, and never a cost field", () => {
    const a = boqHelpAnswer("can I pull the BOQ through the API", list)!.answer;
    for (const p of TENDER_API_PATHS) expect(a).toContain(p);
    for (const t of TENDER_MCP_TOOLS) expect(a).toContain(t);
    expect(a).toContain("tenders scope");
    expect(a).not.toMatch(/unit_cost|markup_pct/);
  });

  it("points at the open tender's BOQ tab when one is open, else at the Tenders list", () => {
    const open = boqHelpAnswer("how do I upload a BOQ", [...list, tenderBoqTarget(UUID)])!;
    expect(open.target.id).toBe(tenderBoqTarget(UUID).id);
    expect(open.answer).toContain("this tender's Bill of quantities tab");
    expect(boqHelpAnswer("how do I upload a BOQ", list)!.target.id).toBe(TENDER_BOQ_LIST_TARGET);
  });

  it("is null without the tender edition and for a question that is not about the BOQ", () => {
    expect(boqHelpAnswer("how do I upload a BOQ", buildNavTargets(ctx({ pipeline: true })))).toBeNull();
    expect(boqHelpAnswer("upload a quote", list)).toBeNull();
  });
});
