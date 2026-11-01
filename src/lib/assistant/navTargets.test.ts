import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { WorkcenterKey } from "@/lib/workcenters";
import { DW_CATALOG, DW_OBJECT_IDS } from "@/lib/import/catalog";
import type { ImportObjectId } from "@/lib/import/types";
import { buildNavTargets, dataWorkbenchTarget, isInternalPath, isNavigationRequest, matchNavigation, matchRecordOpen, screenCatalog, tenderBoqTarget, TENDER_BOQ_LIST_TARGET, type NavGateCtx } from "./navTargets";
import { boqUploadRule } from "./boqHelp";
import { navigateTool } from "./navTools";
import { parsePageContext } from "./objects";

const UUID = "0b8f2a6e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

function ctx(over: Partial<NavGateCtx> & { view?: WorkcenterKey[]; create?: WorkcenterKey[] } = {}): NavGateCtx {
  const view = over.view; const create = over.create;
  return {
    features: { quotations: true, accounts: true, contacts: true, cases: true, wfm: true, products: true },
    isAdmin: false,
    isWfmSupervisor: false,
    canView: (wc) => (view ? view.includes(wc) : true),
    canCreate: (wc) => (create ? create.includes(wc) : true),
    canEdit: () => false,
    ...over,
  };
}

const ids = (c: NavGateCtx) => buildNavTargets(c).map((t) => t.id);

describe("navigation targets are generated per caller", () => {
  it("lists a place the caller can reach, and leaves out every place their workspace has not bought", () => {
    const list = ids(ctx());
    expect(list).toContain("nav:/quotations");
    expect(list).toContain("nav:/accounts");
    expect(list).not.toContain("nav:/invoices"); // invoices module is off
    expect(list).not.toContain("nav:/marketing/abm"); // so is ABM
  });

  it("a Business Role without a view grant removes the place AND its record-less siblings from the enum the model sees", () => {
    const c = ctx({ view: ["accounts"] });
    expect(ids(c)).toContain("nav:/accounts");
    expect(ids(c)).not.toContain("nav:/quotations");
    const tool = navigateTool(buildNavTargets(c));
    const allowed = (tool.input_schema.properties as { target: { enum: string[] } }).target.enum;
    expect(allowed).toContain("nav:/accounts");
    expect(allowed).not.toContain("nav:/quotations");
  });

  it("create targets need the module AND the create grant", () => {
    expect(ids(ctx())).toContain("create:/quotations/new");
    expect(ids(ctx({ create: ["accounts"] }))).not.toContain("create:/quotations/new");
    expect(ids(ctx({ create: ["accounts"] }))).toContain("create:/accounts/new");
    const off = ctx({ features: { accounts: true } });
    expect(ids(off)).not.toContain("create:/quotations/new");
  });

  it("Settings pages are for admins, or members who can edit the page's workcenter", () => {
    expect(ids(ctx()).some((i) => i.startsWith("settings:people"))).toBe(false);
    const admin = ids(ctx({ isAdmin: true }));
    expect(admin).toContain("settings:people");
    expect(admin).toContain("nav:/settings");
    const editor = ids(ctx({ canEdit: (wc) => wc === "quotations" }));
    expect(editor).toContain("settings:products"); // adminOnly, but this member can edit quotations
    expect(editor).not.toContain("settings:people");
  });

  it("supervisor-only workforce pages are hidden from a plain employee", () => {
    expect(ids(ctx())).toContain("nav:/wfm/me");
    expect(ids(ctx()).some((i) => i.startsWith("nav:/wfm/live"))).toBe(false);
    expect(ids(ctx({ isWfmSupervisor: true })).some((i) => i.startsWith("nav:/wfm/live"))).toBe(true);
  });

  it("every target href is an internal path", () => {
    for (const t of buildNavTargets(ctx({ isAdmin: true, features: Object.fromEntries(["quotations", "accounts", "wfm", "marketing", "abm", "products"].map((k) => [k, true])) }))) {
      expect(isInternalPath(t.href), t.href).toBe(true);
    }
  });

  it("ids are unique", () => {
    const all = ids(ctx({ isAdmin: true }));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("plain navigation is answered without a model", () => {
  const targets = buildNavTargets(ctx({ isAdmin: true }));
  it("matches the bare name of a place", () => {
    expect(matchNavigation("open quotations", targets)?.href).toBe("/quotations");
    expect(matchNavigation("Go to the accounts page", targets)?.href).toBe("/accounts");
    expect(matchNavigation("take me to cases.", targets)?.href).toBe("/cases");
    expect(matchNavigation("open quotes", targets)?.href).toBe("/quotations");
  });
  it("matches a create form and a settings page", () => {
    expect(matchNavigation("new quotation", targets)?.href).toBe("/quotations/new");
    expect(matchNavigation("create a new account", targets)?.href).toBe("/accounts/new");
    expect(matchNavigation("open settings company", targets)?.id).toBe("settings:company");
    expect(matchNavigation("go to currency", targets)?.id).toBe("settings:company");
    expect(matchNavigation("open navigation visibility", targets)?.id).toBe("settings:appearance");
    expect(matchNavigation("open email templates", targets)?.id).toBe("settings:quotations");
    expect(matchNavigation("go to small scale pricing", targets)?.id).toBe("settings:pricing");
  });
  it("leaves questions, filters and anything it cannot reach to the model", () => {
    expect(matchNavigation("show me quotes by status", targets)).toBeNull();
    expect(matchNavigation("how many open quotations", targets)).toBeNull();
    expect(matchNavigation("open invoices", targets)).toBeNull(); // not in this workspace
    expect(matchNavigation("", targets)).toBeNull();
  });
  it("does not follow a place the caller cannot see even when named exactly", () => {
    const limited = buildNavTargets(ctx({ view: ["accounts"] }));
    expect(matchNavigation("open quotations", limited)).toBeNull();
  });
  it("tells a request to go somewhere from a data question", () => {
    expect(isNavigationRequest("open the pipeline")).toBe(true);
    expect(isNavigationRequest("take me to SQ-12")).toBe(true);
    expect(isNavigationRequest("show me open quotes")).toBe(false);
  });
});

describe("record references", () => {
  it("reads 'open quote SQ-2026-0012'", () => {
    expect(matchRecordOpen("open quote SQ-2026-0012")).toEqual({ objectType: "quote", ref: "SQ-2026-0012" });
    expect(matchRecordOpen("Show invoice INV-0042.")).toEqual({ objectType: "invoice", ref: "INV-0042" });
    expect(matchRecordOpen("open the standard quote SQ-7")).toEqual({ objectType: "standard_quote", ref: "SQ-7" });
  });
  it("ignores things that are not a reference", () => {
    expect(matchRecordOpen("open quotations")).toBeNull();
    expect(matchRecordOpen("open quote latest")).toBeNull();
  });
});

describe("internal paths", () => {
  it("accepts a path and refuses anything that could leave the app or break out of a string", () => {
    expect(isInternalPath("/quotations/new?account_id=abc")).toBe(true);
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)", "/x'y", "/x\"y", "/a;b", "", "quotations"]) {
      expect(isInternalPath(bad), bad).toBe(false);
    }
    expect(isInternalPath(undefined)).toBe(false);
  });
});

describe("the page the person is on", () => {
  it("reads the object and record from the route", () => {
    expect(parsePageContext(`/quotations/${UUID}`)).toMatchObject({ objectType: "quote", recordId: UUID });
    expect(parsePageContext(`/quotations/${UUID}/edit?x=1`)).toMatchObject({ objectType: "quote", recordId: UUID });
    expect(parsePageContext(`/accounts/${UUID}`)).toMatchObject({ objectType: "account", recordId: UUID });
    expect(parsePageContext(`/standard-quotes/${UUID}`)).toMatchObject({ objectType: "standard_quote" });
    expect(parsePageContext(`/pipeline/${UUID}`)).toMatchObject({ objectType: "opportunity" });
    expect(parsePageContext(`/marketing/leads/${UUID}`)).toMatchObject({ objectType: "lead" });
  });
  it("a list page is in the object's area but on no record", () => {
    expect(parsePageContext("/quotations")).toEqual({ route: "/quotations", objectType: "quote", recordId: null });
  });
  it("is not fooled by /new, a non-UUID segment or an unrelated screen", () => {
    expect(parsePageContext("/quotations/new")).toBeNull();
    expect(parsePageContext("/quotations/not-an-id")).toBeNull();
    expect(parsePageContext("/settings/currency")).toBeNull();
    expect(parsePageContext(null)).toBeNull();
  });
});

describe("a BOQ upload question goes to the tender, not to Estimates", () => {
  const tenderCtx = (over: Partial<NavGateCtx> & { view?: WorkcenterKey[] } = {}) => ctx({ features: { pipeline: true, gcc_tender: true, estimator: true }, ...over });

  it("offers Pipeline, Tenders only to a workspace with the tender edition and a Pipeline view", () => {
    expect(ids(tenderCtx())).toContain(TENDER_BOQ_LIST_TARGET);
    expect(ids(ctx({ features: { pipeline: true } }))).not.toContain(TENDER_BOQ_LIST_TARGET);
    expect(ids(tenderCtx({ view: ["accounts"] }))).not.toContain(TENDER_BOQ_LIST_TARGET);
  });

  it("the target is the Tenders tab and an internal path", () => {
    const t = buildNavTargets(tenderCtx()).find((x) => x.id === TENDER_BOQ_LIST_TARGET)!;
    expect(t.href).toBe("/pipeline?tab=tenders");
    expect(isInternalPath(t.href)).toBe(true);
    expect(matchNavigation("open tenders", [t])?.href).toBe("/pipeline?tab=tenders");
  });

  it("an open tender gets its own Bill of quantities button", () => {
    const t = tenderBoqTarget(UUID);
    expect(t.href).toBe(`/pipeline/${UUID}?tab=boq`);
    expect(isInternalPath(t.href)).toBe(true);
  });

  it("the assistant rule names the upload steps, the template, the columns and the limits, and points at the tender", () => {
    const rule = boqUploadRule(buildNavTargets(tenderCtx()));
    expect(rule).toContain("Bill of quantities");
    expect(rule).toContain("Upload BOQ");
    expect(rule).toContain("Download BOQ template");
    expect(rule).toContain("Item no., Description, Unit, Quantity");
    expect(rule).toContain("2,000 lines and 15 MB");
    expect(rule).toContain(`navigate with ${TENDER_BOQ_LIST_TARGET}`);
    expect(rule).toContain("never Estimates");
    const withOpen = boqUploadRule([...buildNavTargets(tenderCtx()), tenderBoqTarget(UUID)]);
    expect(withOpen).toContain(`navigate with ${tenderBoqTarget(UUID).id}`);
  });

  it("says nothing about BOQs to a workspace without the tender edition", () => {
    expect(boqUploadRule(buildNavTargets(ctx()))).toBe("");
  });
});

describe("Data Workbench objects are targets of their own", () => {
  const bench = (over: Partial<NavGateCtx> & { view?: WorkcenterKey[] } = {}) =>
    ctx({ features: { data_workbench: true, accounts: true, contacts: true, pipeline: true, gcc_tender: true }, ...over });
  const catalog = screenCatalog().filter((e) => e.id.startsWith("nav:/data-workbench?"));

  it("has one target per object and per mode the object has, and none for a mode it lacks", () => {
    let expected = 0;
    for (const id of DW_OBJECT_IDS) {
      for (const mode of DW_CATALOG[id].modes) {
        expect(catalog.some((e) => e.id === dataWorkbenchTarget(mode, id)), `${mode} ${id}`).toBe(true);
        expected++;
      }
    }
    expect(catalog).toHaveLength(expected);
    expect(catalog.map((e) => e.id)).not.toContain(dataWorkbenchTarget("import", "rfqs"));
    expect(catalog.map((e) => e.id)).not.toContain(dataWorkbenchTarget("update", "users"));
    expect(new Set(catalog.map((e) => e.id)).size).toBe(catalog.length);
  });

  it("each one is the deep link the page opens on, an internal path under the Data Workbench section", () => {
    for (const e of catalog) {
      const m = /^nav:\/data-workbench\?tab=(import|export|update)&object=([a-z_]+)$/.exec(e.id)!;
      expect(m, e.id).not.toBeNull();
      expect(e.href).toBe(`/data-workbench?tab=${m[1]}&object=${m[2]}`);
      expect(isInternalPath(e.href), e.href).toBe(true);
      expect(e.section).toBe("Data Workbench");
      expect(e.label).toBe(`${m[1][0].toUpperCase()}${m[1].slice(1)} ${DW_CATALOG[m[2] as ImportObjectId].label}`);
    }
  });

  it("answers to the label and to the words people use for the object", () => {
    const e = catalog.find((x) => x.id === dataWorkbenchTarget("import", "accounts"))!;
    expect(e.names).toContain("Import Accounts");
    expect(e.names).toContain("Upload customers");
    expect(catalog.find((x) => x.id === dataWorkbenchTarget("update", "contacts"))!.names).toContain("Bulk update Contacts");
  });

  it("is offered only when the page, the object's module and its extra flags are all on", () => {
    const t = (c: NavGateCtx) => ids(c);
    expect(t(bench())).toContain(dataWorkbenchTarget("import", "accounts"));
    expect(t(bench())).toContain(dataWorkbenchTarget("export", "tender_boq_lines"));
    expect(t(bench())).not.toContain(dataWorkbenchTarget("import", "cases")); // Cases was not bought
    expect(t(bench({ features: { accounts: true } }))).not.toContain(dataWorkbenchTarget("import", "accounts")); // Data Workbench itself is off
    expect(t(bench({ features: { data_workbench: true, accounts: true, gcc_tender: true } }))).not.toContain(dataWorkbenchTarget("export", "tender_boq_lines")); // no Pipeline
    expect(t(bench({ view: ["accounts"] }))).not.toContain(dataWorkbenchTarget("import", "accounts")); // a Business Role without the Data Workbench grant
  });

  it("the page target is still there beside them", () => {
    expect(ids(bench())).toContain("nav:/data-workbench");
  });

  it("stays client-safe: no server-only module in its imports", () => {
    const src = readFileSync(path.resolve(__dirname, "navTargets.ts"), "utf8");
    for (const banned of ["@/lib/objectFeatures\"", "registrySchema", "supabase-server", "server-only"]) expect(src, banned).not.toContain(banned);
    expect(src).toContain("@/lib/objectFeatureMap");
  });
});
