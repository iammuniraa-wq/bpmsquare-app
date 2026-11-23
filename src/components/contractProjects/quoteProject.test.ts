import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import CreateContractProjectButton from "./CreateContractProjectButton";
import { PROJECT_TIPS } from "@/lib/contractProjects/tips";

// "Create contract project" on an accepted quote, a won quotation, an estimate and the deal (docs/design/won-quote-to-project.md): where
// the action sits, that it renders, and that the confirm keeps its explanation behind the "i" and its tap targets 44 px.

const ROOT = path.resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("the button", () => {
  const out = renderToString(createElement(CreateContractProjectButton, { sourceType: "standard_quote", sourceId: "q1", defaultName: "Acme - SQ-1", lineCount: 3, contractValue: 1000, currency: "SAR", members: [] })).replace(/<!-- -->/g, "");

  it("is one 44 px button and prints no explanation", () => {
    expect(out).toContain("Create contract project");
    expect(out).toContain('data-guide="quote.create_project"');
    expect(out).toContain("min-height:44px");
    expect(out).not.toContain(PROJECT_TIPS.fromQuote);
  });

  it("the confirm is a side panel (a bottom sheet on a phone) with the name, manager and start, and the two numbers shown, not typed", () => {
    const src = read("src/components/contractProjects/CreateContractProjectButton.tsx");
    expect(src).toContain('import SidePanel from "@/components/ui/SidePanel"');
    expect(src).toContain('label="Project name"');
    expect(src).toContain('label="Manager"');
    expect(src).toContain('label="Planned start"');
    expect(src).toContain("Budget lines");
    expect(src).toContain("Contract value");
    expect(src).toContain("PROJECT_TIPS.fromQuote");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("posts the source's own id, and a second press opens the project that exists", () => {
    const src = read("src/components/contractProjects/CreateContractProjectButton.tsx");
    expect(src).toContain("[`${sourceType}_id`]: sourceId");
    expect(src).toContain("if (res.ok || j.project_id) { router.push(ROUTES.contractProject(j.id ?? j.project_id)); return; }");
  });
});

describe("where the action sits", () => {
  it("the standard quote page: in the primary action when accepted, and as a Project fact once it exists", () => {
    const page = read("src/app/(app)/standard-quotes/[id]/page.tsx");
    expect(page).toContain('<QuoteProjectAction sourceType="standard_quote" sourceId={quote.id} ready={isAccepted} />');
    expect(page).toContain('label: "Project"');
    expect(page).toContain('tenant?.features?.contract_projects === true');
  });

  it("the quotation page: a strip, ready when the quotation is won and not superseded", () => {
    expect(read("src/app/(app)/quotations/[id]/page.tsx")).toContain('<QuoteProjectAction sourceType="quotation" sourceId={quote.id} ready={quote.outcome === "won" && !quote.superseded_by} strip />');
  });

  it("the estimate page: a strip, ready when the estimate is won or quoted and has a standard quote", () => {
    expect(read("src/app/(app)/estimates/[id]/page.tsx")).toContain('<QuoteProjectAction sourceType="estimate" sourceId={estimate.id} ready={!!estimate.standard_quote_id && (estimate.status === "won" || estimate.status === "quoted")} strip />');
  });

  it("the deal page: only for a deal that is not a tender, one action per accepted standard quote", () => {
    const page = read("src/app/(app)/pipeline/[id]/page.tsx");
    expect(page).toContain("const acceptedQuotes = !tender && tenant?.features?.contract_projects === true && tenant?.features?.standard_quotes === true");
    expect(page).toContain('<QuoteProjectAction key={q.id} sourceType="standard_quote" sourceId={q.id} ready strip />');
  });

  it("the action renders nothing unless the module is on, and the existing project is a link", () => {
    const src = read("src/components/contractProjects/QuoteProjectAction.tsx");
    expect(src).toContain('if (tenant?.features?.contract_projects !== true) return null;');
    expect(src).toContain("ROUTES.contractProject(existing.id)");
    expect(src).toContain("canEditWorkcenter(perms, \"contract_projects\")");
  });
});
