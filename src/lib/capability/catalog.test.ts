import { describe, it, expect } from "vitest";
// The extractor is plain JS (it also runs as a CLI), so it is imported untyped.
import { extractFacts } from "../../../scripts/build-capability-facts.mjs";
import committed from "./facts.generated.json";
import { getCapabilityCatalog, catalogById } from "./catalog";
import { buildCapabilityCatalog, missingPlainWords, type CatalogInputs, type Facts } from "./generate";
import { sliceForArea, AREA_MODULES } from "./slice";
import { AREA_IDS } from "@/lib/studio/types";
import { SETTINGS_GROUPS } from "@/lib/settingsMenu";

const fresh = extractFacts() as Facts;

describe("capability facts", () => {
  it("the committed facts match the source (run: node scripts/build-capability-facts.mjs)", () => {
    // Compared as parsed JSON so a Windows checkout's line endings cannot fail it.
    expect(committed).toEqual(JSON.parse(JSON.stringify(fresh)));
  });

  it("every module flag has a hand-written plain-words entry in docs/capabilities", () => {
    expect(fresh.features.length).toBeGreaterThan(30);
    expect(missingPlainWords(fresh), "add docs/capabilities/<module>.md for these module flags").toEqual([]);
  });

  it("fails for a module that has no plain-words entry", () => {
    const f: Facts = {
      ...fresh,
      features: [...fresh.features, { key: "brand_new_module", comment: "" }],
    };
    expect(missingPlainWords(f)).toEqual(["brand_new_module"]);
    const blank: Facts = { ...fresh, capabilityDocs: { ...fresh.capabilityDocs, leads: { status: "live", plain: "  ", rules: [] } } };
    expect(missingPlainWords(blank)).toEqual(["leads"]);
  });
});

describe("the generated catalogue", () => {
  const catalog = getCapabilityCatalog();
  const featureKeys = new Set(fresh.features.map((f) => f.key));

  it("has one module entry per flag and unique ids", () => {
    for (const k of featureKeys) expect(catalogById(catalog).has(`cap.module.${k}`), k).toBe(true);
    expect(new Set(catalog.map((e) => e.id)).size).toBe(catalog.length);
  });

  it("only points at real modules", () => {
    for (const e of catalog) if (e.module) expect(featureKeys, `${e.id} -> ${e.module}`).toContain(e.module);
  });

  it("is generated from the code: screens, settings, objects, fields, connectors, hooks", () => {
    const kinds = new Set(catalog.map((e) => e.kind));
    for (const k of ["module", "screen", "object", "field", "setting", "api", "mcp", "connector", "extension_point", "rule"]) expect(kinds, k).toContain(k);
    expect(catalogById(catalog).get("cap.object.estimate")?.module).toBe("estimator");
    expect(catalogById(catalog).get("cap.extension.quotesignatureslot")).toBeTruthy();
  });

  it("marks the unreleased experience flags experimental, and their screens with them", () => {
    expect(catalogById(catalog).get("cap.module.next_experience")?.status).toBe("experimental");
    expect(catalogById(catalog).get("cap.module.process_studio")?.status).toBe("live");
    expect(catalog.filter((e) => e.module === "next_experience").every((e) => e.status === "experimental")).toBe(true);
  });

  it("keeps the Dynamics 365 connector's real state visible", () => {
    const d365 = catalogById(catalog).get("cap.connector.dynamics365");
    expect(d365?.caveat).toMatch(/not yet run/i);
    expect(d365?.plain).toMatch(/not yet run/i);
  });

  it("copies dependencies onto modules", () => {
    expect(catalogById(catalog).get("cap.module.wfm_projects")?.needs).toEqual(expect.arrayContaining(["wfm"]));
  });
});

describe("the per-area slice", () => {
  const catalog = getCapabilityCatalog();

  it("never offers an unreleased entry to a prospect", () => {
    for (const area of AREA_IDS) {
      const slice = sliceForArea(catalog, area);
      expect(slice.every((e) => e.status === "live"), area).toBe(true);
    }
  });

  it("can include unreleased entries when the owner decides to show them", () => {
    const withAll = sliceForArea(catalog, "sales", { includeUnreleased: true });
    expect(withAll.some((e) => e.status === "experimental")).toBe(false); // none of Nova's modules belong to an area
    const set = new Set(catalog.map((e) => e.id));
    expect(withAll.every((e) => set.has(e.id))).toBe(true);
  });

  it("keeps each area to its own modules plus the cross-cutting ones", () => {
    const sales = sliceForArea(catalog, "sales");
    expect(sales.some((e) => e.id === "cap.module.estimator")).toBe(true);
    expect(sales.some((e) => e.id === "cap.module.wfm")).toBe(false);
    const wf = sliceForArea(catalog, "workforce");
    expect(wf.some((e) => e.id === "cap.module.wfm")).toBe(true);
    expect(wf.some((e) => e.id === "cap.module.rfq")).toBe(false);
    for (const area of AREA_IDS) expect(AREA_MODULES[area].every((m) => fresh.features.some((f) => f.key === m)), area).toBe(true);
  });

  it("gives every area a usable, not-huge slice", () => {
    for (const area of AREA_IDS) {
      const n = sliceForArea(catalog, area).length;
      expect(n, area).toBeGreaterThan(5);
      expect(n, area).toBeLessThan(450);
    }
  });
});

describe("the generator, in isolation", () => {
  it("falls back to the source comment when a module has no entry, and marks status from the entry", () => {
    const inputs: CatalogInputs = {
      facts: {
        features: [{ key: "leads", comment: "From a comment." }],
        extensionHooks: [], mcp: { version: "1", tools: [] },
        capabilityDocs: {},
      },
      nav: [], settingsGroups: SETTINGS_GROUPS, settings: [], registry: {} as CatalogInputs["registry"],
      listSources: [], connectors: [], dependencies: [],
    };
    const out = buildCapabilityCatalog(inputs);
    expect(out.find((e) => e.id === "cap.module.leads")?.plain).toBe("From a comment.");
    expect(out.find((e) => e.id === "cap.api.v1")).toBeTruthy();
  });
});
