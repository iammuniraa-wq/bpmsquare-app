import { describe, expect, it } from "vitest";
import { classifyLabel, detectColumns, detectLayout, extractLines, linesFromRows, multilineText, parseClientColumns, parseColumnMap, parseNumber, readHeaderInfo, type Grid } from "./parse";
import { diffBoq, type ExistingLine } from "./diff";
import { BOQ_TABLE_TIPS } from "./tips";
import { TENDER_TIPS } from "../tips";
import { tipTextProblems } from "@/lib/infoTip";

// The client's own sheet (docs/design/boq-client-format.md), as pure rules on a grid: which column is the item number, what Section is,
// where the Narration and the Description go, what is kept as client data, the title block, and that a Description-only file is unchanged.

const HEAD = ["Sr #", "Bill #", "Section", "Page #", "Revision #", "Item #", "Boq #", "Narration", "Description", "Unit", "QTY", "Rate", "Amount"];
const grid = (): Grid => [
  ["Project Code", "C1093"],
  ["Project Name", "CS & A Work for IPA Project"],
  [],
  HEAD,
  [154, "A", "00", "00", "00", "A1516", "A-00-00-00-A1516", "Steel stair", "1) First line\r\n2) Second line", "M", "337.100", "4,570.000", "1,540,547.000"],
  [155, "A", "00", "00", "00", "A1518", "A-00-00-00-A1518", "Grouting (Non-shrink) (For steel structure)", "1) Non-shrink", "M3", 10.13, 4014, 40661.82],
  [156, "A", "00", "00", "00", "A1521", "A-00-00-00-A1521", "Anchor Bolt (M20, L=825mm)", "", "EA", 574, 66.7, 38285.8],
];

describe("the item number, the section and the new fields", () => {
  it("Item # is the item number, not Sr #; Section is not a cost code; Narration is its own field", () => {
    const { map } = detectColumns(HEAD);
    expect(map).toEqual({ item_no: 6, narration: 8, description: 9, uom: 10, qty: 11, rate: 12, amount: 13 });
  });

  it("an Item column beats a serial number wherever it sits, and a serial number alone is still the item number", () => {
    expect(detectColumns(["Item", "Sl No", "Description", "Qty"]).map.item_no).toBe(1);
    expect(detectColumns(["Sl No", "Item no", "Description", "Qty"]).map.item_no).toBe(2);
    expect(detectColumns(["Sr #", "Description", "Qty"]).map.item_no).toBe(1);
    expect(classifyLabel("Section").map((h) => h.field)).not.toContain("cost_code");
    expect(classifyLabel("Section no").map((h) => h.field)).not.toContain("cost_code");
    expect(detectColumns(["Item", "Description", "Qty", "Cost code"]).map.cost_code).toBe(4);
    expect(detectColumns(["Item", "Description", "Qty", "WBS"]).map.cost_code).toBe(4);
  });

  it("a sheet whose only text column is a Narration reads it as the description", () => {
    expect(detectColumns(["Item", "Narration", "Qty"]).map).toEqual({ item_no: 1, description: 2, qty: 3 });
    expect(parseColumnMap({ narration: 2, qty: 3 })).toEqual({ description: 2, qty: 3 });
    expect(parseColumnMap({ narration: 2, description: 4, qty: 3 })).toEqual({ narration: 2, description: 4, qty: 3 });
  });

  it("finds the header row under the title block", () => {
    expect(detectLayout(grid()).headerRow).toBe(4);
  });
});

describe("the lines", () => {
  const { lines, skipped, header_info, client_columns } = extractLines(grid(), 4, detectColumns(HEAD).map);

  it("the name is the Narration, the details are the Description with line breaks kept, the numbers parse", () => {
    expect(lines.map((l) => [l.item_no, l.description, l.qty, l.file_rate, l.uom, l.cost_code])).toEqual([
      ["A1516", "Steel stair", 337.1, 4570, "M", null],
      ["A1518", "Grouting (Non-shrink) (For steel structure)", 10.13, 4014, "M3", null],
      ["A1521", "Anchor Bolt (M20, L=825mm)", 574, 66.7, "EA", null],
    ]);
    expect(lines[0].details).toBe("1) First line\n2) Second line");
    expect(lines[1].details).toBe("1) Non-shrink");
    expect(lines[2].details).toBeNull();
    expect(lines.map((l) => l.key)).toEqual(["n:a1516", "n:a1518", "n:a1521"]);
    expect(skipped).toEqual([]);
  });

  it("keeps every other column as client data, in the client's words, and nothing for an empty cell", () => {
    expect(client_columns).toEqual(["Sr #", "Bill #", "Section", "Page #", "Revision #", "Boq #"]);
    expect(lines[0].client_data).toEqual({ "Sr #": "154", "Bill #": "A", Section: "00", "Page #": "00", "Revision #": "00", "Boq #": "A-00-00-00-A1516" });
  });

  it("reads the title block", () => {
    expect(header_info).toEqual({ project_code: "C1093", project_name: "CS & A Work for IPA Project" });
    expect(readHeaderInfo([["Project Code: C77", null, "Client", "KAMCO"], ["Tender no", "T-5"], HEAD], 3)).toEqual({ project_code: "C77", client: "KAMCO", tender_no: "T-5" });
    expect(readHeaderInfo([["Project Code", "Project Name"], ["C1", "Name one"], HEAD], 3)).toEqual({ project_code: "C1", project_name: "Name one" });
    expect(readHeaderInfo([HEAD], 1)).toEqual({});
  });

  it("a Description-only file is exactly as before: the name is the description, no details, and unmapped columns are the only client data", () => {
    const g: Grid = [["Item", "Description", "Unit", "Qty"], ["1", "Plain  line", "m", 3]];
    const out = extractLines(g, 1, detectColumns(g[0]).map);
    expect(out.lines[0]).toMatchObject({ item_no: "1", description: "Plain line", uom: "m", qty: 3, details: null, client_data: null });
    expect(out.client_columns).toEqual([]);
    expect(out.header_info).toEqual({});
  });

  it("a Narration that equals the Description adds no details", () => {
    const g: Grid = [["Item", "Narration", "Description", "Qty"], ["1", "Same", "Same", 3]];
    expect(extractLines(g, 1, detectColumns(g[0]).map).lines[0].details).toBeNull();
  });

  it("tidies multi-line text and reads the numbers the client types", () => {
    expect(multilineText("a  \r\n\r\n\r\n\r\nb \t c")).toBe("a\n\nb c");
    expect(parseNumber("1,540,547.000")).toBe(1540547);
    expect(parseNumber("337.100")).toBe(337.1);
  });
});

describe("revised sheets and Data Workbench cells", () => {
  const existing = (over: Partial<ExistingLine> = {}): ExistingLine => ({ key: "n:1", item_no: "1", description: "Name", uom: "m", qty: 1, cost_code: null, details: "old", priced: false, removed: false, ...over });
  const incoming = (over: Record<string, unknown> = {}) => ({ row_no: 5, item_no: "1", description: "Name", details: "old", uom: "m", qty: 1, cost_code: null, file_rate: null, key: "n:1", ...over });

  it("a changed details text is a change; an unchanged one is not; a database without the column compares nothing", () => {
    expect(diffBoq([existing()], [incoming({ details: "new" })]).changed[0].fields).toEqual(["details"]);
    expect(diffBoq([existing()], [incoming()]).unchanged).toBe(1);
    expect(diffBoq([existing({ details: undefined })], [incoming({ details: "new" })]).unchanged).toBe(1);
  });

  it("Client columns cells are a JSON object of text, or empty", () => {
    expect(parseClientColumns("")).toEqual({ ok: true, data: null });
    expect(parseClientColumns('{"Sr #":"154","Page #":7,"":"x","Empty":""}')).toEqual({ ok: true, data: { "Sr #": "154", "Page #": "7" } });
    expect(parseClientColumns("Sr #: 154")).toEqual({ ok: false });
    expect(parseClientColumns("[1,2]")).toEqual({ ok: false });
  });

  it("rows from Data Workbench follow the Excel rule: a Narration is the name and the Description the details", () => {
    const { lines, failed } = linesFromRows([
      { rowNum: 2, values: { item_no: "A1", narration: "Short name", description: "Long\ntext", quantity: "2", client_columns: '{"Bill #":"A"}' } },
      { rowNum: 3, values: { item_no: "A2", description: "Name only", details: "Kept", quantity: "1" } },
      { rowNum: 4, values: { item_no: "A3", description: "Plain", quantity: "1" } },
      { rowNum: 5, values: { item_no: "A4", description: "Bad", quantity: "1", client_columns: "nope" } },
    ]);
    expect(lines.map((l) => [l.description, l.details, l.client_data])).toEqual([
      ["Short name", "Long\ntext", { "Bill #": "A" }], ["Name only", "Kept", null], ["Plain", null, null],
    ]);
    expect(failed.map((f) => f.rowNum)).toEqual([5]);
  });
});

describe("the new explanations fit behind an i", () => {
  it.each([["details", BOQ_TABLE_TIPS.details], ["clientColumns", BOQ_TABLE_TIPS.clientColumns], ["boqClientData", TENDER_TIPS.boqClientData], ["boqTemplate", TENDER_TIPS.boqTemplate], ["boqMapping", TENDER_TIPS.boqMapping]])("%s", (_k, text) => {
    expect(tipTextProblems(text)).toEqual([]);
  });
});
