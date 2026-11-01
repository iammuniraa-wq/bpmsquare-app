import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; className?: string; children: unknown }) => createElement("a", { href: p.href, className: p.className }, p.children as never) }));

import { tipTextProblems } from "@/lib/infoTip";
import { DW_CATALOG } from "@/lib/import/catalog";
import type { ImportObjectId, ObjectSpec } from "@/lib/import/types";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { DW_TIPS, needsFirstTip } from "./tips";

// bpmsquarecore 6b on the Data Workbench screens (docs/design/data-workbench-redesign.md slice 4): labels, values and
// actions on screen, every explanation behind an "i", and a data-guide id on every control the assistant can point at.

const root = path.resolve(__dirname, "../../../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const DIR = "src/app/(app)/data-workbench/";
const FILES = ["DataWorkbenchClient.tsx", "ObjectPicker.tsx", "ObjectHeader.tsx", "StartScreen.tsx", "ExportFlow.tsx", "ColumnMapper.tsx", "page.tsx"].map((f) => DIR + f);

const spec = (id: ImportObjectId, label: string, over: Partial<ObjectSpec> = {}): ObjectSpec => ({
  id, label, icon: "▣", description: "", dependsOn: [],
  fields: [{ key: "name", label: "Name", type: "text", required: true, hint: "Name" }, { key: "email", label: "Email", type: "email", hint: "Email" }], sampleRows: [], ...over,
});
const objects = [
  { spec: spec("accounts", "Accounts"), catalog: DW_CATALOG.accounts },
  { spec: spec("contacts", "Contacts", { dependsOn: ["accounts"] }), catalog: DW_CATALOG.contacts },
  { spec: spec("quotes", "Quotes", { dependsOn: ["accounts", "contacts"] }), catalog: DW_CATALOG.quotes },
];
const html = (q: string) => { search = q; return renderToString(createElement(DataWorkbenchClient, { objects, unowned: [], recentsKey: "k" })); };

describe("guide-mode ids", () => {
  const sources = FILES.map(read).join("\n");
  it.each([
    "dw.picker", "dw.search", "dw.start.import", "dw.start.export", "dw.start.update", "dw.change",
    "dw.mode.import", "dw.mode.export", "dw.mode.update", "dw.template", "dw.upload", "dw.extract", "dw.review.run", "dw.export.download",
  ])("%s is on a control", (id) => {
    expect(sources).toContain(`"${id}"`);
  });

  it("the rendered Import screen carries the ones it shows", () => {
    const out = html("object=accounts");
    for (const id of ["dw.picker", "dw.search", "dw.mode.import", "dw.mode.export", "dw.mode.update", "dw.template", "dw.upload", "dw.required"]) expect(out, id).toContain(`data-guide="${id}"`);
    expect(html("object=contacts")).toContain('data-guide="dw.needs"');
    expect(html("object=quotes")).toContain('data-guide="dw.extract"');
    expect(html("tab=export&object=accounts")).toContain('data-guide="dw.export.download"');
    expect(html("tab=update&object=accounts")).toContain('data-guide="dw.needs_export"');
    expect(html("")).toContain('data-guide="dw.start.import"');
  });
});

describe("no printed hint lines", () => {
  const client = read(DIR + "DataWorkbenchClient.tsx");
  const exportFlow = read(DIR + "ExportFlow.tsx");
  const mapper = read(DIR + "ColumnMapper.tsx");
  const page = read(DIR + "page.tsx");

  it("the removed paragraphs are gone from the source", () => {
    for (const gone of [
      "Upload any document", "Or start from the template", "Or use a file you exported", "Upload your file", "Already have your data in a spreadsheet",
      "you'll match them to fields", "has no dependencies", "Creates draft quotes without lines", "Only adds lines to a quote",
      "Only adds lines to a draft", "must contain each quote's line items",
    ]) expect(client, gone).not.toContain(gone);
    expect(exportFlow).not.toContain("it's what lets you re-upload");
    expect(exportFlow).not.toContain("Only rows matching every filter below");
    expect(mapper).not.toContain("are left untouched");
    expect(page).not.toContain("subtitle=");
  });

  it("every subtitle left on a section is a line of data (the file, its counts), never a sentence of advice", () => {
    const subtitles = [...client.matchAll(/subtitle=\{?`([^`]*)`/g)].map((m) => m[1]);
    expect(subtitles.length).toBeGreaterThan(0);
    for (const t of subtitles) expect(t, t).toMatch(/\$\{(fileName|rows\.length|sheet)/);
    expect(client).not.toMatch(/subtitle="/);
  });

  it("the screen prints no explanation of its own: the Import upload step is chips, the drop zone and two buttons", () => {
    const out = html("object=contacts");
    expect(out).toContain("Needs Accounts first");
    expect(out).toContain("Required: Name");
    expect(out).toContain("Drop a file here, or click to browse");
    expect(out).toContain("Download Contacts template");
    for (const sentence of [DW_TIPS.template, DW_TIPS.ownColumns, DW_TIPS.required, needsFirstTip("Contacts", 1)]) expect(out).not.toContain(sentence);
    expect(out.match(/data-guide="dw.upload"/g)).toHaveLength(1);
    // One card, not three: the old step stacked an AI card, a template card and an upload card.
    expect(out).not.toContain("Upload your file");
  });

  it("Update says what it needs in a chip and offers Export, not a paragraph", () => {
    const out = html("tab=update&object=accounts");
    expect(out).toContain("Needs a file from Export");
    expect(out).toContain("Go to Export");
    expect(out).not.toContain(DW_TIPS.needsExport);
  });

  it("only Quotes offers to read a document", () => {
    expect(html("object=quotes")).toContain("Read a PDF or Word document");
    expect(html("object=accounts")).not.toContain("Read a PDF or Word document");
    expect(html("tab=update&object=quotes")).not.toContain("Read a PDF or Word document");
  });

  it("the page header has an i, no subtitle paragraph", () => {
    expect(page).toContain("info={DW_TIPS.page}");
  });
});

describe("every explanation fits behind an i", () => {
  it("the dependency tip, for one object and for several", () => {
    for (const label of ["Accounts", "Standard Quote Lines", "Sales Order Lines"]) {
      for (const n of [1, 2, 3]) expect(tipTextProblems(needsFirstTip(label, n)), `${label} ${n}`).toEqual([]);
    }
  });

  it("every InfoTip text in the screens comes from DW_TIPS, the catalog or a short literal that fits", () => {
    const client = read(DIR + "DataWorkbenchClient.tsx");
    for (const m of client.matchAll(/<InfoTip label="[^"]*">\{?"?([^<{}]*?)"?\}?<\/InfoTip>/g)) {
      const text = m[1].trim();
      if (text) expect(tipTextProblems(text), text).toEqual([]);
    }
  });
});

describe("the phone", () => {
  it("the primary action of each step sits in the sticky bar, which clears the fixed tab bar", () => {
    const css = read(DIR + "DataWorkbench.module.css");
    expect(css).toMatch(/\.actionBar[^}]*position:\s*sticky/);
    expect(css).toMatch(/max-width:\s*780px\)\s*\{[^}]*bottom:\s*calc\(58px/);
    expect(css).toMatch(/min-height:\s*44px/);
    const client = read(DIR + "DataWorkbenchClient.tsx");
    expect(client).toContain("sticky-actions-page");
    expect((client.match(/className=\{s\.actionBar\}/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(read(DIR + "ExportFlow.tsx")).toContain("s.actionBar");
  });

  it("the step bar wraps instead of scrolling sideways", () => {
    expect(read(DIR + "DataWorkbenchClient.tsx")).toMatch(/flexWrap: "wrap", gap: "6px 6px"/);
  });
});
