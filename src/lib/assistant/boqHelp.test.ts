import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BOQ_LIMITS } from "@/lib/tender/boq/parse";
import { TENDER_BOQ_LINES_SPEC } from "@/lib/import/tenderBoqLinesSchema";
import { DATA_WORKBENCH_TARGET, TENDER_API_PATHS, TENDER_MCP_TOOLS, boqUploadRule } from "./boqHelp";
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
