import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToString } from "react-dom/server";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; className?: string; children: unknown }) => createElement("a", { href: p.href, className: p.className }, p.children as never) }));

import SidePanel from "@/components/ui/SidePanel";
import { DW_CATALOG, DW_GROUPS, DW_OBJECT_IDS, type DwGroupId } from "@/lib/import/catalog";
import type { ImportObjectId, ObjectSpec } from "@/lib/import/types";
import DataWorkbenchClient from "./DataWorkbenchClient";
import ObjectPicker from "./ObjectPicker";
import { SMALL_WORKSPACE, isInteractive, notSwitchedOnReply, pickerItems, pickerKey, searchEntries, shouldFocusSearch, stepHighlight, type PickerEntry, type PickerItem, type PickerUnowned } from "./pickerModel";

// The picker (docs/design/data-workbench-redesign.md 2b, slice 3). The model is pure, so the rules are tested without a
// browser; the component and the sheet are rendered on the server.

const real = (ids: ImportObjectId[]): PickerEntry[] =>
  ids.map((id) => ({ id, label: id.replace(/_/g, " "), icon: "▣", group: DW_CATALOG[id].group, parent: DW_CATALOG[id].parent, modes: DW_CATALOG[id].modes, keywords: DW_CATALOG[id].keywords }));
const labelled = (id: ImportObjectId, label: string, e: PickerEntry[]) => e.map((x) => (x.id === id ? { ...x, label } : x));

// An 80-object workspace: today's 28 plus 52 invented ones spread over the six groups, a quarter of them lines.
function fake80(): PickerEntry[] {
  const out = real(DW_OBJECT_IDS);
  const groups = DW_GROUPS.map((g) => g.id);
  for (let i = 0; out.length < 80; i++) {
    const group = groups[i % groups.length];
    const parent = i % 4 === 3 ? out.find((e) => e.group === group && !e.parent)?.id : undefined;
    out.push({ id: `future_${i}`, label: `Future object ${i}`, icon: "▫", group, parent, modes: ["import", "export", "update"], keywords: ["sample"] });
  }
  return out;
}
const items = (o: Partial<Parameters<typeof pickerItems>[0]> & { entries: PickerEntry[] }) =>
  pickerItems({ unowned: [], query: "", selectedId: null, mode: null, recents: [], overrides: {}, ...o });
const kinds = (it: PickerItem[], kind: PickerItem["kind"]) => it.filter((x) => x.kind === kind);

describe("the picker at 80 objects", () => {
  const entries = fake80();

  it("has 80 objects and nothing selected shows only the six group headers and the recents", () => {
    expect(entries).toHaveLength(80);
    const recents = ["accounts", "contacts", "cases", "quotes", "invoices", "users", "assets"];
    const it = items({ entries, recents });
    expect(kinds(it, "group")).toHaveLength(6);
    // Five recents at most, and no object row beyond them: every group is closed.
    expect(kinds(it, "object")).toHaveLength(5);
    expect(kinds(it, "group").every((g) => g.kind === "group" && !g.open)).toBe(true);
  });

  it("opens only the group that holds the selected object", () => {
    const it = items({ entries, selectedId: "cases" });
    const open = kinds(it, "group").filter((g) => g.kind === "group" && g.open).map((g) => g.kind === "group" && g.id);
    expect(open).toEqual(["service"]);
  });

  it("a person's own choice wins and is kept", () => {
    const it = items({ entries, selectedId: "cases", overrides: { service: false, sales: true } });
    const open = kinds(it, "group").filter((g) => g.kind === "group" && g.open).map((g) => g.kind === "group" && g.id);
    expect(open).toEqual(["sales"]);
  });

  it("counts every object of a group, lines included", () => {
    const g = kinds(items({ entries }), "group").find((x) => x.kind === "group" && x.id === "master");
    expect(g && g.kind === "group" && g.count).toBe(entries.filter((e) => e.group === "master").length);
  });

  it("a search narrows 80 to the few that match", () => {
    const hits = items({ entries, query: "future object 7" });
    expect(kinds(hits, "object").length).toBeGreaterThan(0);
    expect(kinds(hits, "object").length).toBeLessThanOrEqual(10);
  });
});

describe("a small workspace", () => {
  const entries = real(["accounts", "contacts", "products", "product_bom_lines", "users"]);
  it("has every group open (at or below the limit)", () => {
    expect(entries.length).toBeLessThanOrEqual(SMALL_WORKSPACE);
    const it = items({ entries });
    expect(kinds(it, "group").every((g) => g.kind === "group" && g.open)).toBe(true);
    expect(kinds(it, "object")).toHaveLength(5);
  });

  it("nests lines under their parent, indented", () => {
    const rows = kinds(items({ entries }), "object").map((o) => o.kind === "object" && [o.id, o.child]);
    expect(rows).toEqual([["accounts", false], ["contacts", false], ["products", false], ["product_bom_lines", true], ["users", false]]);
  });

  it("a line whose parent the workspace does not own stands on its own", () => {
    const rows = kinds(items({ entries: real(["product_bom_lines"]) }), "object");
    expect(rows[0].kind === "object" && rows[0].child).toBe(false);
  });
});

describe("recents in the picker", () => {
  const entries = real(["accounts", "contacts", "cases"]);
  it("lists at most five that the workspace still owns, above the groups", () => {
    const it = items({ entries, recents: ["cases", "gone", "accounts"] });
    expect(it.slice(0, 4).map((x) => x.kind === "object" ? x.id : x.kind)).toEqual(["section", "cases", "accounts", "section"]);
  });
  it("none when there are none", () => {
    expect(kinds(items({ entries }), "section")).toHaveLength(0);
  });
});

describe("search", () => {
  const entries = labelled("tender_boq_lines", "Tender BOQ lines", real(DW_OBJECT_IDS));

  it("finds a child by a word of its label, with its group as the caption", () => {
    const it = items({ entries, query: "boq" });
    const hit = it.find((x) => x.kind === "object" && x.id === "tender_boq_lines");
    expect(hit && hit.kind === "object" && hit.caption).toBe("Sales");
    expect(it.every((x) => x.kind === "object")).toBe(true);
  });

  it("finds by keyword and by id words", () => {
    expect(searchEntries(entries, "companies").map((e) => e.id)).toContain("accounts");
    expect(searchEntries(entries, "purchase order").map((e) => e.id)).toContain("purchase_orders");
  });

  it("is case-insensitive and needs every word", () => {
    expect(searchEntries(entries, "ACCOUNTS").map((e) => e.id)).toContain("accounts");
    expect(searchEntries(entries, "accounts zzzz")).toEqual([]);
  });

  it("puts a name that contains the text before one that only has it as a keyword", () => {
    const e: PickerEntry[] = [
      { id: "alpha", label: "Alpha", icon: "▫", group: "sales", modes: ["import"], keywords: ["order"] },
      { id: "orders", label: "Orders", icon: "▫", group: "sales", modes: ["import"], keywords: [] },
    ];
    expect(searchEntries(e, "order").map((x) => x.id)).toEqual(["orders", "alpha"]);
  });

  it("nothing matching says so", () => {
    const it = items({ entries, query: "zzzz" });
    expect(it).toEqual([{ kind: "notice", key: "none", text: "Nothing matches." }]);
  });
});

describe("an object the workspace does not have", () => {
  const entries = real(["accounts", "contacts"]);
  const unowned: PickerUnowned[] = [
    { id: "cases", label: "Cases", keywords: DW_CATALOG.cases.keywords },
    { id: "work_orders", label: "Work Orders", keywords: DW_CATALOG.work_orders.keywords },
  ];

  it("is never listed, in any state", () => {
    const all = JSON.stringify([items({ entries, unowned }), items({ entries, unowned, selectedId: "accounts" }), items({ entries, unowned, recents: ["cases"] })]);
    expect(all).not.toContain("Cases");
    expect(all).not.toContain("cases");
    expect(all).not.toContain("Work Orders");
  });

  it("is named, in one line, only in reply to a search that matches nothing owned", () => {
    expect(items({ entries, unowned, query: "cases" })).toEqual([{ kind: "notice", key: "none", text: "Cases is not switched on in this workspace." }]);
    expect(items({ entries, unowned, query: "tickets" })[0]).toMatchObject({ kind: "notice", text: "Cases is not switched on in this workspace." });
    expect(notSwitchedOnReply(unowned, "work")).toBe("Work Orders is not switched on in this workspace.");
  });

  it("names several in one sentence", () => {
    expect(notSwitchedOnReply(unowned, "zzzz")).toBeNull();
    expect(notSwitchedOnReply([...unowned, { id: "x", label: "Inspections", keywords: ["cases"] }], "cases")).toBe("Cases and Inspections are not switched on in this workspace.");
  });

  it("is not offered when the search finds something the workspace does have", () => {
    const withBoth = [...entries, ...real(["quotes"])];
    const it = items({ entries: withBoth, unowned: [{ id: "quote_lines", label: "Quote Lines", keywords: ["line items"] }], query: "quote" });
    expect(it.every((x) => x.kind === "object")).toBe(true);
  });
});

describe("a mode the object lacks", () => {
  const entries = real(["rfqs", "accounts", "users"]);
  const caption = (it: PickerItem[], id: string) => { const o = it.find((x) => x.kind === "object" && x.id === id); return o && o.kind === "object" ? o.caption : undefined; };
  it("is a caption on the row while that mode is in play, and the row stays", () => {
    const imp = items({ entries, mode: "import" });
    expect(caption(imp, "rfqs")).toBe("no import");
    expect(caption(imp, "accounts")).toBeUndefined();
    expect(caption(items({ entries, mode: "update" }), "users")).toBe("no update");
    expect(kinds(items({ entries, mode: "update" }), "object")).toHaveLength(3);
  });
  it("is no caption when no mode is in play", () => {
    expect(caption(items({ entries, mode: null }), "rfqs")).toBeUndefined();
  });
});

describe("the keyboard", () => {
  const entries = real(["accounts", "contacts", "products", "product_bom_lines"]);
  const rows = items({ entries, query: "" }).filter(isInteractive);

  it("steps over the rows and stops at both ends", () => {
    expect(stepHighlight(-1, "ArrowDown", 4)).toBe(0);
    expect(stepHighlight(3, "ArrowDown", 4)).toBe(3);
    expect(stepHighlight(0, "ArrowUp", 4)).toBe(0);
    expect(stepHighlight(2, "End", 4)).toBe(3);
    expect(stepHighlight(2, "Home", 4)).toBe(0);
    expect(stepHighlight(0, "ArrowDown", 0)).toBe(-1);
  });

  it("ArrowDown then Enter opens the first row", () => {
    const down = pickerKey({ key: "ArrowDown", query: "", hl: -1, rows });
    expect(down).toMatchObject({ handled: true, hl: 0 });
    const enter = pickerKey({ key: "Enter", query: "", hl: down.hl, rows });
    expect(enter.act).toEqual({ kind: "toggle", id: "master", open: false });
  });

  it("Enter on an object row opens that object", () => {
    const idx = rows.findIndex((r) => r.kind === "object" && r.id === "contacts");
    expect(pickerKey({ key: "Enter", query: "", hl: idx, rows }).act).toEqual({ kind: "open", id: "contacts" });
  });

  it("Enter with nothing highlighted does nothing", () => {
    expect(pickerKey({ key: "Enter", query: "", hl: -1, rows })).toMatchObject({ handled: false });
  });

  it("Esc clears the text first, then asks the host to close", () => {
    expect(pickerKey({ key: "Escape", query: "acc", hl: 0, rows })).toMatchObject({ handled: true, query: "", hl: -1 });
    expect(pickerKey({ key: "Escape", query: "", hl: -1, rows }).act).toEqual({ kind: "close" });
  });

  it("Home and End are the text cursor's until something is typed", () => {
    expect(pickerKey({ key: "Home", query: "", hl: 2, rows }).handled).toBe(false);
    expect(pickerKey({ key: "End", query: "a", hl: 0, rows })).toMatchObject({ handled: true, hl: rows.length - 1 });
  });

  it("a search result is walked the same way", () => {
    const found = items({ entries, query: "acc" }).filter(isInteractive);
    expect(pickerKey({ key: "Enter", query: "acc", hl: 0, rows: found }).act).toEqual({ kind: "open", id: "accounts" });
  });

  it("/ focuses the search unless the cursor is in a field", () => {
    expect(shouldFocusSearch({ key: "/" }, null)).toBe(true);
    expect(shouldFocusSearch({ key: "/" }, { tagName: "BODY" })).toBe(true);
    expect(shouldFocusSearch({ key: "/" }, { tagName: "INPUT" })).toBe(false);
    expect(shouldFocusSearch({ key: "/" }, { tagName: "textarea" })).toBe(false);
    expect(shouldFocusSearch({ key: "/" }, { tagName: "DIV", isContentEditable: true })).toBe(false);
    expect(shouldFocusSearch({ key: "/", ctrlKey: true }, null)).toBe(false);
    expect(shouldFocusSearch({ key: "a" }, null)).toBe(false);
  });
});

describe("the component", () => {
  const entries = real(["accounts", "contacts", "products", "product_bom_lines", "users"]);
  const props = { entries, unowned: [] as PickerUnowned[], selectedId: "contacts", mode: "import" as const, recents: ["accounts"], overrides: {}, onToggleGroup: () => {}, onPick: () => {} };
  const html = renderToString(createElement(ObjectPicker, props));

  it("is a labelled search over a list of 44 px-tall buttons, with the selection marked", () => {
    expect(html).toContain('aria-label="Find an object"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('data-guide="dw.search"');
    expect(html).toMatch(/aria-current="true"[^>]*title="contacts"/);
    expect(html).toContain("Recent");
    expect(html).toContain("All objects");
    expect(html).toContain("Master data");
    expect(html).toContain("└");
  });

  it("draws no per-row 'N fields' line, no explanation text", () => {
    expect(html).not.toMatch(/\d+ fields/);
  });
});

// createElement's overloads reject a component whose required `children` come as the third argument.
const withChildren = createElement as unknown as (c: unknown, p: object | null, ...kids: unknown[]) => ReactElement;

describe("the phone sheet", () => {
  const entries = real(["accounts", "cases"]);
  const inSheet = renderToString(withChildren(SidePanel, { title: "Choose an object", onClose: () => {} },
    createElement(ObjectPicker, { entries, unowned: [], selectedId: null, mode: null, recents: [], overrides: {}, onToggleGroup: () => {}, onPick: () => {}, autoFocus: true, guide: "dw.search.sheet" })));

  it("is a dialog with the same picker inside", () => {
    expect(inSheet).toContain('role="dialog"');
    expect(inSheet).toContain('aria-label="Choose an object"');
    expect(inSheet).toContain('data-guide="dw.search.sheet"');
    expect(inSheet).toContain("Master data");
  });

  const root = path.resolve(__dirname, "../../../..");
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

  it("the column hides under 900 px and the working area is first on a phone", () => {
    const css = read("src/app/(app)/data-workbench/DataWorkbench.module.css");
    const phone = css.slice(css.indexOf("@media (max-width: 899px)"));
    expect(phone).toMatch(/\.grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(phone).toMatch(/\.col\s*\{\s*display:\s*none/);
    expect(phone).toMatch(/button\.change\s*\{\s*display:\s*inline-flex/);
    const client = read("src/app/(app)/data-workbench/DataWorkbenchClient.tsx");
    expect(client).toContain('<SidePanel title="Choose an object"');
    expect(client).toContain("setSheetOpen(false)");
    // The sheet closes on a pick.
    expect(client.slice(client.indexOf("function openObject"), client.indexOf("function chooseTask"))).toContain("setSheetOpen(false)");
  });

  it("the Change chip and the 'Choose an object' button are the phone's two ways in", async () => {
    const { default: ObjectHeader } = await import("./ObjectHeader");
    const head = renderToString(createElement(ObjectHeader, { spec: { id: "accounts", label: "Accounts", icon: "▣", description: "d", dependsOn: [], fields: [], sampleRows: [] } as ObjectSpec, catalog: DW_CATALOG.accounts, mode: "import", onMode: () => {}, onChange: () => {} }));
    expect(head).toContain("Change ▾");
    expect(head).toContain('data-guide="dw.change"');
    search = "";
    const start = renderToString(createElement(DataWorkbenchClient, { objects: [], unowned: [], recentsKey: "k" }));
    expect(start).toContain("Choose an object");
  });
});

describe("hidden objects stay hidden in the page", () => {
  it("a workspace without Cases never sees it in the markup, only in the reply to a link", () => {
    const spec = (id: ImportObjectId, label: string): ObjectSpec => ({ id, label, icon: "▣", description: "", dependsOn: [], fields: [], sampleRows: [] });
    const objects = [{ spec: spec("accounts", "Accounts"), catalog: DW_CATALOG.accounts }];
    const unowned = [{ id: "cases" as ImportObjectId, label: "Cases" }];
    search = "";
    expect(renderToString(createElement(DataWorkbenchClient, { objects, unowned, recentsKey: "k" }))).not.toContain("Cases");
    search = "object=cases";
    expect(renderToString(createElement(DataWorkbenchClient, { objects, unowned, recentsKey: "k" }))).toContain("Cases is not switched on in this workspace");
  });

  it("every group id the picker draws is one the catalog declares", () => {
    const ids = new Set<DwGroupId>(DW_GROUPS.map((g) => g.id));
    for (const e of fake80()) expect(ids.has(e.group)).toBe(true);
  });
});
