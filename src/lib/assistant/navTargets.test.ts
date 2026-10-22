import { describe, expect, it } from "vitest";
import type { WorkcenterKey } from "@/lib/workcenters";
import { buildNavTargets, isInternalPath, isNavigationRequest, matchNavigation, matchRecordOpen, type NavGateCtx } from "./navTargets";
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
