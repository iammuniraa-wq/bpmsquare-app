import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TenantFeatures } from "@/lib/constants";
import { featureForObject } from "@/lib/objectFeatures";
import { tipTextProblems } from "@/lib/infoTip";
import { DW_CATALOG, DW_GROUPS, DW_MODES, DW_OBJECT_IDS, ownedObjectIds, supportedMode } from "./catalog";
import { defaultObjectDescription, defaultObjectLabel, REGISTRY_OBJECT_TYPE } from "./registrySchema";
import { USERS_SPEC } from "./usersSchema";
import { QUOTE_LINES_SPEC } from "./quoteLinesSchema";
import { PRODUCT_BOM_LINES_SPEC } from "./productBomLinesSchema";
import { CONSENTS_SPEC } from "./consentsSchema";
import { STANDARD_QUOTE_LINES_SPEC } from "./standardQuoteLinesSchema";
import { SALES_ORDER_LINES_SPEC } from "./salesOrderLinesSchema";
import { TENDER_BOQ_LINES_SPEC } from "./tenderBoqLinesSchema";
import { EMPLOYEES_SPEC } from "./employeesSchema";
import type { ImportObjectId, ObjectSpec } from "./types";

// The guard behind the Data Workbench picker (docs/design/data-workbench-redesign.md 3c): a new object that is
// missing, misplaced or mislabelled fails the build here instead of surfacing as a wrong row in the picker.

const API = join(__dirname, "..", "..", "app", "api");
const ids = DW_OBJECT_IDS;
const STATIC: ObjectSpec[] = [USERS_SPEC, QUOTE_LINES_SPEC, EMPLOYEES_SPEC, PRODUCT_BOM_LINES_SPEC, CONSENTS_SPEC, STANDARD_QUOTE_LINES_SPEC, SALES_ORDER_LINES_SPEC, TENDER_BOQ_LINES_SPEC];
const staticById = new Map(STATIC.map((s) => [s.id, s]));

describe("the catalog covers every object once, in a real group", () => {
  it("has an entry for every ImportObjectId the registry knows", () => {
    expect([...ids].sort()).toEqual(Object.keys(REGISTRY_OBJECT_TYPE).sort());
  });

  it("names a group that exists", () => {
    const groups = new Set(DW_GROUPS.map((g) => g.id));
    for (const id of ids) expect(groups.has(DW_CATALOG[id].group), id).toBe(true);
  });

  it("every group is used and group ids are unique", () => {
    expect(new Set(DW_GROUPS.map((g) => g.id)).size).toBe(DW_GROUPS.length);
    for (const g of DW_GROUPS) expect(ids.some((id) => DW_CATALOG[id].group === g.id), g.id).toBe(true);
  });
});

describe("parents", () => {
  it("exist, share the group and are never themselves a child (one level only)", () => {
    for (const id of ids) {
      const p = DW_CATALOG[id].parent;
      if (!p) continue;
      expect(DW_CATALOG[p], `${id} -> ${p}`).toBeDefined();
      expect(DW_CATALOG[p].group, `${id} -> ${p} group`).toBe(DW_CATALOG[id].group);
      expect(DW_CATALOG[p].parent, `${p} is a child itself`).toBeUndefined();
      expect(p).not.toBe(id);
    }
  });
});

describe("modes match the route folders", () => {
  for (const mode of DW_MODES) {
    it(`${mode}: an object has the mode exactly when src/app/api/${mode}/<id>/route.ts exists`, () => {
      for (const id of ids) {
        const has = existsSync(join(API, mode, id, "route.ts"));
        expect(DW_CATALOG[id].modes.includes(mode), `${mode}/${id}`).toBe(has);
      }
    });
  }

  it("every object has at least one mode and lists them in the tab order", () => {
    for (const id of ids) {
      const modes = DW_CATALOG[id].modes;
      expect(modes.length, id).toBeGreaterThan(0);
      expect([...modes], id).toEqual(DW_MODES.filter((m) => modes.includes(m)));
    }
  });

  it("a mode the object lacks says why, and a mode it has needs no reason", () => {
    for (const id of ids) {
      const e = DW_CATALOG[id];
      for (const m of DW_MODES) {
        if (e.modes.includes(m)) expect(e.modeNote?.[m], `${id}.${m}`).toBeUndefined();
        else expect(e.modeNote?.[m], `${id}.${m}`).toBeTruthy();
      }
    }
  });

  it("supportedMode keeps a supported mode and falls back to the first one", () => {
    expect(supportedMode("accounts", "update")).toBe("update");
    expect(supportedMode("rfqs", "import")).toBe("export");
    expect(supportedMode("users", "update")).toBe("import");
    expect(supportedMode("consents", "nonsense")).toBe("import");
  });
});

describe("labels", () => {
  it("are unique, case-insensitively, across the registry and the static specs", () => {
    const labels = new Map<string, ImportObjectId>();
    for (const id of ids) {
      const label = (staticById.get(id)?.label ?? defaultObjectLabel(id)).toLowerCase();
      expect(labels.has(label), `"${label}" is used by both ${labels.get(label)} and ${id}`).toBe(false);
      labels.set(label, id);
    }
  });

  it("the catalog's label is the one the registry and the static specs carry (the assistant cannot read a spec)", () => {
    for (const id of ids) expect(DW_CATALOG[id].label, id).toBe(staticById.get(id)?.label ?? defaultObjectLabel(id));
  });

  it("the registry's default label agrees with the static spec's own", () => {
    for (const s of STATIC) expect(defaultObjectLabel(s.id), s.id).toBe(s.label);
  });
});

describe("what the picker searches and the headers explain", () => {
  it("every object has keywords, none of them blank", () => {
    for (const id of ids) {
      const k = DW_CATALOG[id].keywords;
      expect(k.length, id).toBeGreaterThan(0);
      for (const w of k) expect(w.trim(), id).not.toBe("");
    }
  });

  it("every note and mode note fits behind an i", () => {
    for (const id of ids) {
      const e = DW_CATALOG[id];
      if (e.note !== undefined) expect(tipTextProblems(e.note), `${id}.note`).toEqual([]);
      for (const [m, t] of Object.entries(e.modeNote ?? {})) expect(tipTextProblems(t!), `${id}.modeNote.${m}`).toEqual([]);
    }
  });

  it("the header explanation (the note, else the description) fits behind an i for every object", () => {
    for (const id of ids) {
      const description = staticById.get(id)?.description ?? defaultObjectDescription(id);
      const text = DW_CATALOG[id].note ?? description;
      // An object with no words at all simply has no "i"; one with words must hold to the limit.
      if (text.trim()) expect(tipTextProblems(text), `${id} header tip`).toEqual([]);
    }
  });
});

describe("module ownership", () => {
  it("featureForObject accepts every id, so a catalog entry never outruns OBJECT_FEATURE", () => {
    for (const id of ids) expect(() => featureForObject(id), id).not.toThrow();
  });

  it("alsoNeeds names only flags that TenantFeatures has (a typo would gate on a flag that is always false)", () => {
    const src = readFileSync(join(__dirname, "..", "constants.ts"), "utf8");
    const body = src.slice(src.indexOf("export type TenantFeatures = {"));
    const known = new Set([...body.slice(0, body.indexOf(String.fromCharCode(10) + "};")).matchAll(/^\s{2}(\w+): boolean;/gm)].map((m) => m[1]));
    expect(known.size).toBeGreaterThan(20);
    for (const id of ids) for (const k of DW_CATALOG[id].alsoNeeds ?? []) expect(known, `${id}.alsoNeeds "${k}"`).toContain(k);
  });
});

// The filter page.tsx used before the catalog: OBJECT_ORDER, the two hard-coded special cases and featureForObject.
const LEGACY_ORDER: ImportObjectId[] = [
  "accounts", "contacts", "assets", "suppliers", "products", "product_bom_lines", "wfm_projects", "opportunities", "rfqs", "estimates", "abm_programs", "abm_targets", "abm_members", "quotes", "quote_lines", "standard_quotes", "standard_quote_lines", "sales_orders", "sales_order_lines", "tender_boq_lines",
  "cases", "work_orders", "invoices", "purchase_orders", "inventory",
  "users", "employees", "consents",
];
function legacyOwned(features: Partial<Record<string, boolean>>): ImportObjectId[] {
  return LEGACY_ORDER.filter((id) => {
    const key = featureForObject(id);
    if (id === "consents" && features.marketing !== true) return false;
    if (id === "tender_boq_lines" && features.pipeline !== true) return false;
    return key === null || features[key] === true;
  });
}
function extraKeys(): (keyof TenantFeatures)[] {
  return [...new Set(ids.flatMap((id) => [...(DW_CATALOG[id].alsoNeeds ?? []), ...[featureForObject(id)].filter((k): k is keyof TenantFeatures => k !== null)]))];
}

describe("the list a workspace sees is the one it saw before the catalog", () => {
  const keys = extraKeys();
  const sets: [string, Partial<Record<string, boolean>>][] = [
    ["nothing on", {}],
    ["everything on", Object.fromEntries(keys.map((k) => [k, true]))],
    // The Gulf tender workspace: Data Workbench is on and the tender edition with it.
    ["tender edition", { accounts: true, contacts: true, pipeline: true, gcc_tender: true, estimator: true, contract_projects: true, rfq: true, data_workbench: true }],
    ["marketing without the consent flag", { marketing: true, accounts: true }],
    ["consent flag without marketing", { marketing_scoring: true, accounts: true }],
    ["gcc_tender without pipeline", { gcc_tender: true }],
    ...keys.map((k): [string, Partial<Record<string, boolean>>] => [`only ${k}`, { [k]: true }]),
    ...keys.map((k): [string, Partial<Record<string, boolean>>] => [`all but ${k}`, Object.fromEntries(keys.filter((x) => x !== k).map((x) => [x, true]))]),
  ];
  it.each(sets)("%s", (_name, features) => {
    const want = new Set(legacyOwned(features));
    expect(new Set(ownedObjectIds(features, featureForObject))).toEqual(want);
  });

  it("lists the same 28 objects the page listed, no more", () => {
    expect([...ids].sort()).toEqual([...LEGACY_ORDER].sort());
    expect(ids).toHaveLength(28);
  });

  it("tender BOQ lines need the Pipeline as well as the tender edition, consents need Marketing as well as their own flag", () => {
    expect(DW_CATALOG.tender_boq_lines).toMatchObject({ group: "sales", parent: "opportunities", alsoNeeds: ["pipeline"] });
    expect(DW_CATALOG.consents.alsoNeeds).toEqual(["marketing"]);
  });
});
