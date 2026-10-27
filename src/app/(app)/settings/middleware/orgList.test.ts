import { describe, expect, it } from "vitest";
import { createElement as create, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { orgKey } from "@/lib/middleware/erpOrgPure";
import type { OrgDirectoryView } from "./api";
import { listChoices } from "./mappingLogic";
import { MIDDLEWARE_TIPS } from "./tips";
import { ListTable } from "./MappingValueLists";
import { draftOf, listProblems, orgChoicesForRow, removedOrgRows } from "./valueListLogic";

const el = create as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;
const html = (e: ReactElement) => renderToString(e);

const SEG = "aaaaaaaa-0000-4000-8000-000000000001";
const SEG_GONE = "aaaaaaaa-0000-4000-8000-000000000009";
const OT = "bbbbbbbb-0000-4000-8000-000000000001";
const org: OrgDirectoryView = {
  names: { segment: { [SEG]: "Saudi retail" }, order_type: { [OT]: "Export order" } },
  options: [{ key: orgKey("segment", SEG), label: "Saudi retail", group: "Coverage" }, { key: orgKey("order_type", OT), label: "Export order", group: "Order type" }],
};
const list = (kind: string, rows: { bpm: string; erp: string }[]) => draftOf({ kind, label: kind === "sales_area" ? "Sales area" : "ERP company", rows: rows.map((r) => ({ ...r, inbound: true })), default_in: null });

describe("the Sales area / ERP company list on the Mapping tab", () => {
  it("shows the coverage or order type by its NAME in a pick list, never the key, and no unknown-inbound default", () => {
    const out = html(el(ListTable, { draft: list("sales_area", [{ bpm: orgKey("segment", SEG), erp: "1000/10/00" }]), org, onChange: () => undefined }));
    expect(out).toContain("Coverage or order type");
    expect(out).toContain("Saudi retail");
    expect(out).toContain("Export order");
    expect(out).toContain("<optgroup");
    expect(out).toContain("value_list.org_pick");
    expect(out).toContain("1000/10/00");
    expect(out).not.toContain("Default for unknown inbound");
    expect(out).not.toContain(`segment:${SEG}">segment`);
  });

  it("a row whose coverage was deleted says so instead of showing a key", () => {
    const d = list("sales_area", [{ bpm: orgKey("segment", SEG_GONE), erp: "1000/10/00" }]);
    expect(html(el(ListTable, { draft: d, org, onChange: () => undefined }))).toContain("(removed coverage)");
    expect(removedOrgRows(d, org.names)).toBe(1);
  });

  it("an ordinary list is untouched by it", () => {
    const out = html(el(ListTable, { draft: list("unit", [{ bpm: "Nos", erp: "EA" }]), org, onChange: () => undefined }));
    expect(out).toContain("BPMSquare value");
    expect(out).toContain("Default for unknown inbound");
    expect(out).not.toContain("<optgroup");
  });

  it("offers each coverage and order type once: the ones another row uses are left out, this row's own stays", () => {
    const d = list("sales_area", [{ bpm: orgKey("segment", SEG), erp: "1000/10/00" }, { bpm: "", erp: "" }]);
    expect(orgChoicesForRow(org, d, 1).choices.map((c) => c.label)).toEqual(["Export order"]);
    expect(orgChoicesForRow(org, d, 0).choices.map((c) => c.label)).toEqual(["Saudi retail", "Export order"]);
    expect(orgChoicesForRow(org, d, 0).own).toBeNull();
  });

  it("flags a bad sales area under its code cell and a code with no pick under the pick, but lets an empty code save", () => {
    const d = list("sales_area", [{ bpm: orgKey("segment", SEG), erp: "1000/10" }, { bpm: "", erp: "2000/20/10" }, { bpm: orgKey("order_type", OT), erp: "" }]);
    const p = listProblems(d);
    expect(p.find((x) => x.row === 0)).toMatchObject({ col: "erp" });
    expect(p.find((x) => x.row === 1)?.message).toBe("Pick a coverage or an order type for this row.");
    expect(p.some((x) => x.row === 2)).toBe(false);
    expect(listProblems(list("erp_company", [{ bpm: orgKey("segment", SEG), erp: "anything/goes" }]))).toEqual([]);
    const shown = html(el(ListTable, { draft: d, org, onChange: () => undefined }));
    expect(shown).toContain("is not a sales area");
  });

  it("is not something a mapping field's Value list converter can point at", () => {
    expect(listChoices([], ["sales_area"]).map((l) => l.kind)).not.toContain("sales_area");
    expect(listChoices(["erp_company"], []).map((l) => l.kind)).not.toContain("erp_company");
    expect(listChoices([], []).map((l) => l.kind)).toContain("unit");
  });

  it("explains itself behind the i, in the shared limit", () => {
    expect(MIDDLEWARE_TIPS.orgSalesArea.length).toBeLessThanOrEqual(160);
    expect(MIDDLEWARE_TIPS.orgCompany.length).toBeLessThanOrEqual(160);
  });
});
