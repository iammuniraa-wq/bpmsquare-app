import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({ default: (p: { href: string; className?: string; children: unknown }) => createElement("a", { href: p.href, className: p.className }, p.children as never) }));

import Tabs from "@/components/ui/Tabs";
import { DW_CATALOG } from "@/lib/import/catalog";
import type { ImportObjectId, ObjectSpec } from "@/lib/import/types";
import DataWorkbenchClient from "./DataWorkbenchClient";
import { modeTabs, objectTip } from "./ObjectHeader";

// The object lives in the URL, the start screen is what no object means, and a mode an object lacks is a greyed tab with
// a reason (docs/design/data-workbench-redesign.md 2a, 2d). Server render only: the effects (recents, URL rewrite) need a browser.

const spec = (id: ImportObjectId, label: string, icon = "▣"): ObjectSpec => ({ id, label, icon, description: `${label} description`, dependsOn: [], fields: [{ key: "name", label: "Name", type: "text", required: true, hint: "Name" }], sampleRows: [] });
const objects = (ids: [ImportObjectId, string][]) => ids.map(([id, label]) => ({ spec: spec(id, label), catalog: DW_CATALOG[id] }));
const OWNED = objects([["accounts", "Accounts"], ["contacts", "Contacts"], ["rfqs", "RFQs"], ["users", "Users"]]);
const UNOWNED = [{ id: "cases" as ImportObjectId, label: "Cases" }];
const html = (q: string) => { search = q; return renderToString(createElement(DataWorkbenchClient, { objects: OWNED, unowned: UNOWNED, recentsKey: "dw-recents:t:u" })); };

describe("a disabled tab", () => {
  it("is a real disabled tab, with its reason behind an i that names it", () => {
    const tabs = modeTabs(DW_CATALOG.users);
    expect(tabs.map((t) => [t.id, !!t.disabled])).toEqual([["import", false], ["export", false], ["update", true]]);
    expect(tabs[2].info).toBe(DW_CATALOG.users.modeNote?.update);
    const out = renderToString(createElement(Tabs, { tabs, value: "import", onChange: () => {}, label: "Data Workbench modes" }));
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Update<\/button>/);
    expect(out).toContain('aria-label="About Update"');
    // Only the greyed tab carries an i; the reason is not printed.
    expect(out.match(/bpm-tip"/g)).toHaveLength(1);
    expect(out).not.toContain("Access changes are made in Settings");
    expect(out).toContain('data-guide="dw.mode.update"');
  });

  it("every mode of RFQs, Consents and Users that is off has a reason", () => {
    for (const id of ["rfqs", "consents", "users"] as const) {
      for (const t of modeTabs(DW_CATALOG[id])) if (t.disabled) expect(t.info, `${id}.${t.id}`).toBeTruthy();
    }
  });
});

describe("the object header's i", () => {
  it("says the catalog note, else the description", () => {
    expect(objectTip(DW_CATALOG.quotes, { description: "long" })).toBe(DW_CATALOG.quotes.note);
    expect(objectTip(DW_CATALOG.accounts, { description: " Companies " })).toBe("Companies");
  });
});

describe("what the URL opens", () => {
  it("no object: the start screen with three tasks, no object header", () => {
    const out = html("");
    expect(out).toContain("What do you want to do?");
    for (const t of ["Bring data in", "Take data out", "Fix data in bulk"]) expect(out).toContain(t);
    expect(out).not.toContain("Upload your file");
    expect(out).not.toContain("not switched on");
  });

  it("?tab=update with no object is the start screen with that task marked", () => {
    const out = html("tab=update");
    expect(out).toContain("What do you want to do?");
    expect(out).toMatch(/aria-pressed="true"[^>]*data-guide="dw.start.update"/);
    expect(out).not.toMatch(/aria-pressed="true"[^>]*data-guide="dw.start.import"/);
  });

  it("?tab=import&object=accounts opens Accounts on Import", () => {
    const out = html("tab=import&object=accounts");
    expect(out).toContain("Accounts");
    expect(out).toContain("Upload your file");
    expect(out).not.toContain("What do you want to do?");
    expect(out).toMatch(/aria-selected="true"[^>]*>Import</);
  });

  it("?tab=update&object=contacts opens Contacts on Update", () => {
    const out = html("tab=update&object=contacts");
    expect(out).toMatch(/aria-selected="true"[^>]*>Update</);
    expect(out).toContain("Or use a file you exported");
  });

  it("an object that lacks the mode in the link opens on its first supported mode", () => {
    const rfqs = html("tab=import&object=rfqs");
    expect(rfqs).toMatch(/aria-selected="true"[^>]*>Export</);
    expect(rfqs).toContain("Choose columns");
    const users = html("tab=update&object=users");
    expect(users).toMatch(/aria-selected="true"[^>]*>Import</);
  });

  it("an object the workspace does not have lands on the start screen with one honest line", () => {
    const out = html("object=cases");
    expect(out).toContain("What do you want to do?");
    expect(out).toContain("Cases is not switched on in this workspace");
  });

  it("an id that is not an object at all says nothing about it", () => {
    const out = html("object=not_a_thing");
    expect(out).toContain("What do you want to do?");
    expect(out).not.toContain("not switched on");
  });

  it("a child shows where it belongs", () => {
    const withParent = [...OWNED, ...objects([["product_bom_lines", "BOM components"], ["products", "Products"]])];
    search = "object=product_bom_lines";
    const child = renderToString(createElement(DataWorkbenchClient, { objects: withParent, unowned: [], recentsKey: "k" }));
    expect(child).toContain("Master data");
    expect(child).toContain("lines of Products");
  });
});
